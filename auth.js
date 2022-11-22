'use strict';

/**
 * @class ButtressAuth
 */
class ButtressAuth {
  /**
   * Creates an instance of ButtressAuth
   */
  constructor() {}

  /**
   * execute
   * @return {Promise}
   */
  async getAuthUser(userId) {
    const user = await Buttress.User.get(userId);
    delete user.auth;

    const [person] = await Buttress.getCollection('people').search({
      authId: {
        $eq: user.id,
      },
    });
    user.person = person;

    return user;
  }
}

module.exports = ButtressAuth;
