// ======== DB-Model: ========
// "_id"           -> ID
// "name"          -> String
// "short"         -> String
// "claim"         -> String
// "description"   -> String
// "createdby"     -> userId
// "time_created"  -> Date
// "time_lastedit" -> Date
// "members"       -> List of userIds
// ===========================

Groups = new Meteor.Collection("Groups");
GroupLib = {};

/* Find groups for given filters
 * 
 * filter: dictionary with filter options
 *   own: Limit to groups where logged-in user is a member
 *   user: Limit to groups where given user ID is a member (client only)
 *
 */
GroupLib.find = function(filter, limit) {
	var find = {};
	
	if (filter.own) {
		var me = Meteor.userId();
		if (!me) return []; // I don't exist? How could I be in a group?!

		find.members = me;
	}

	// If the property is set but falsy, we don't return anything
	if (filter.hasOwnProperty('user')) {
		if (!filter.user) return [];
		find.members = filter.user;
	}

	return Groups.find(find);
};

GroupLib.isMember = function(userId, groupId) {
	check(userId, String);
	check(groupId, String);
	return Groups.find({
		_id: groupId,
		members: userId
	}).count() > 0;
};


Meteor.methods({
	saveGroup: function(groupId, changes) {
		check(groupId, String);
		check(changes, {
			short:       Match.Optional(String),
			name:        Match.Optional(String),
			claim:       Match.Optional(String),
			description: Match.Optional(String),
		});

		var isNew = groupId === 'create';

		// Load group from DB
		var group;
		if (isNew) {
			// Saving user is added as first member of the group
			group = {
				members: [Meteor.userId()]
			};
		} else {
			group = Groups.findOne(groupId);
			if (!group) throw new Meteor.Error(404, "Group not found");
		}

		// User must be member of group to edit it
		if (!isNew && !GroupLib.isMember(Meteor.userId(), group._id)) {
			throw new Meteor.error(401, "Denied");
		}

		var updates = {};
		if (changes.short) {
			updates.short = changes.short.substring(0, 50);
		}
		if (changes.hasOwnProperty('name')) {
			updates.name = changes.name.substring(0, 200);
		}
		if (changes.hasOwnProperty('claim')) {
			updates.claim = changes.claim.substring(0, 1000);
		}
		if (changes.hasOwnProperty('description')) {
			updates.description = changes.description.substring(0, 640*1024);
			if (Meteor.isServer) {
				updates.description = saneHtml(updates.description);
			}
		}

		if (isNew) {
			return Groups.insert(_.extend(group, updates));
		} else {
			return Groups.update(group._id, { $set: updates });
		}
	},

	updateGroupMembership: function(userId, groupId, join) {
		check(userId, String);
		check(groupId, String);

		var senderId = Meteor.userId();
		if (!senderId) return;

		// Only current members of the group may draft other people into it
		var sel = {
			_id: groupId,
			members: senderId
		}

		var user = Meteor.users.findOne({_id: userId});
		if (!user) throw new Meteor.Error(404, "User not found");

		var update;
		if (join) {
			update = { $addToSet: { 'members': user._id } }
		} else {
			update = { $pull: { 'members': user._id } }
		}

		Groups.update(sel, update, checkUpdateOne);
	},

	/* Update listing of a course or an event in a group. */
	updateGroupListing: function(thingId, groupId, join) {
		check(thingId, String);
		check(groupId, String);

		var senderId = Meteor.userId();
		if (!senderId) return;

		// Only current members of the group may list courses into groups
		if (!GroupLib.isMember(senderId, groupId)) {
			throw new Meteor.Error(401, "Denied");
		}

		var update;
		if (join) {
			update = { $addToSet: { 'groups': group._id } };
		} else {
			update = { $pull: { 'groups': group._id } };
		}

		// Welcome to my world of platypus-typing
		// Because thing may either be a group or an event, we just try both!
		var changed = Courses.update(thingId, update)
		            + Events.update(thingId, update);

		if (changed !== 1) throw new Meteor.Error(500, "Query affected "+changed+" documents, expected 1");
	}
});