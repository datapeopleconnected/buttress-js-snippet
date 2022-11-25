'use strict';

/**
 * @class Google
 */
class Google {
  /**
   * Creates an instance of Google
   */
  constructor() {}

  /**
   * googleOAuth2
   * @param {Object} googleKey
   * @return {Promise}
   */
  async googleGetOAuth2URL(googleKey) {
    if (!googleKey) {
      throw new Error('Missing required secure store data');
    }

    const storeData = googleKey.storeData.reduce((obj, output) => {
      const data = obj.data;
      Object.keys(data).forEach((key) => {
        if (key.toUpperCase() === 'CLIENT_ID') {
          output[key.toUpperCase()] = data[key];
        }
        if (key.toUpperCase() === 'REDIRECT_URI') {
          output[key.toUpperCase()] = data[key];
        }
        if (key.toUpperCase() === 'SCOPE') {
          output[key.toUpperCase()] = data[key];
        }
      });

      return output;
    }, {});

    const clientId = storeData['CLIENT_ID'];
    const redirectURI = storeData['REDIRECT_URI'];
    const scope = storeData['SCOPE'];
    if (!clientId || !redirectURI || !scope) {
      throw new Error('Missing some Google credentials');
    }

    const includeGrantedScopes = true;
    const responseType = 'code';
    const accessType = 'offline';
    return `https://accounts.google.com/o/oauth2/v2/auth/identifier?approval_prompt=force&client_id=${clientId}&redirect_uri=${redirectURI}&include_granted_scopes=${includeGrantedScopes}&response_type=${responseType}&scope=${scope}&access_type=${accessType}`;
  }

  /**
   * googleOAuth2Callback
   * @param {Object} googleKey
   * @param {Object} allowedMembers
   * @param {String} code
   * @return {Promise}
   */
  async googleOAuth2Callback(googleKey, allowedMembers, code) {
    if (!googleKey || !allowedMembers) {
      throw new Error('Missing required secure store data');
    }

    const storeData = googleKey.storeData.reduce((obj, output) => {
      const data = obj.data;
      Object.keys(data).forEach((key) => {
        if (key.toUpperCase() === 'CLIENT_ID') {
          output[key.toUpperCase()] = data[key];
        }
        if (key.toUpperCase() === 'CLIENT_SECRET') {
          output[key.toUpperCase()] = data[key];
        }
        if (key.toUpperCase() === 'REDIRECT_URI') {
          output[key.toUpperCase()] = data[key];
        }
      });

      return output;
    }, {});

    const clientId = storeData['CLIENT_ID'];
    const redirectURI = storeData['REDIRECT_URI'];
    const scope = storeData['SCOPE'];
    if (!clientId || !redirectURI || !scope) {
      throw new Error('Missing some Google credentials');
    }

    const grantType = 'authorization_code';
    const authResult = await lambdaAPI('fetch', {
      url: `https://oauth2.googleapis.com/token?code=${code}&client_id=${clientId}&client_secret=${clientSecert}&redirect_uri=${redirectURI}&grantType=${grantType}`,
      options: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    });
    const accessToken = authResult.res.body.access_token;
    const profileResult = await lambdaAPI('fetch', {
      url: 'https://openidconnect.googleapis.com/v1/userinfo',
      options: {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
      },
    });

    const profile = profileResult.res.body;
    const user = {
      app: 'google',
      id: profile.sub,
      username: profile.name,
      token: accessToken,
      refreshToken: authResult.res.body.refresh_token,
      email: profile.email,
      profileUrl: profile.picture,
      profileImgUrl: profile.picture,
      bannerImgUrl: '',
      locale: profile.locale,
      policyProperties: {
        role: 'developer',
      },
    };
    const authentication = {
      authLevel: 1,
      domains: [
        'lifty.local.nodestream.app',
      ],
      role: 'public',
      permissions: [
        {route: '*', permission: '*'},
      ],
    };

    let teamRole = false;
    // Check to see if one of the emails matches against a team email.
    const allowedMember = allowedMembers.storeData.find((t) => profile.email === t.data.email && profile.email_verified);
    if (allowedMember) {
      teamRole = allowedMember.data.role;
    }

    // Early out as this user isn't part of the team roster.
    if (!teamRole) {
      lambda.logError(`AUTH: User ${profile.name} not part allowed list using ${profile.email}`);
      throw new Error(`AUTH: User ${profile.name} not part allowed list using ${profile.email}`);
    }

    user.policyProperties.role = teamRole;
    lambda.logDebug(`AUTH: Pending ${profile.name} using ${profile.email}`);

    const buttressUser = await Buttress.Auth.findOrCreateUser(user, authentication);

    if (!buttressUser) {
      lambda.logError(`AUTH: User ${profile.name} profile doesn't exist using ${profile.email}`);
      throw new Error(`AUTH: User ${profile.name} profile doesn't exist using ${profile.email}`);
    }

    lambda.logDebug(`AUTH: Success ${profile.name} using ${buttressUser.id}`);

    // Check to see if tokens is empty
    if (!buttressUser.tokens || buttressUser.tokens.length < 1) {
      lambda.logDebug(`AUTH: Missing token for ${buttressUser.id}:${profile.name}`);
      const token = await Buttress.Auth.createToken(buttressUser.id, authentication);
      buttressUser.tokens.push(token);
      return buttressUser;
    }

    buttressUser.service = `google`;

    const people = await Buttress.getCollection('people').getAll();
    const person = people.find((p) => p.authId === buttressUser.id);
    if (!person) {
      const personObject = Buttress.getCollection('people').createObject();
      const name = profile.name;

      const title = name.salutation ? name.salutation + ' ' : '';

      personObject.authId = buttressUser.id;
      personObject.title = name.salutation;
      personObject.formalName = `${title}${profile.given_name} ${profile.family_name}`.trim();
      personObject.name = `${profile.given_name} ${profile.family_name}`.trim();
      personObject.forename = profile.given_name;
      personObject.initials = name.initials ? name.initials + ' ' : '';
      personObject.surname = profile.family_name;
      personObject.suffix = name.suffix;
      personObject.emails = [profile.email];
      personObject.avatar = profile.picture;

      await Buttress.getCollection('people').save(personObject);
    }

    return {
      userId: buttressUser.id,
    };
  }
}

module.exports = new Google();
