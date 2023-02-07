'use strict';

/**
 * @class GoogleAuth
 */
class GoogleAuth {
  /**
   * Creates an instance of GoogleAuth
   */
  constructor() {}

  /**
   * googleGetOAuth2URL
   * @param {Object} googleKey
   * @return {Promise}
   */
  async googleGetOAuth2URL(googleKey) {
    if (!googleKey) {
      throw new Error('Missing required secure store data');
    }

    const storeData = googleKey.storeData.reduce((output, data) => {
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
   * @param {Object} domainsKey
   * @param {Object} allowedMembers
   * @return {Promise}
   */
  async googleOAuth2Callback(googleKey, domainsKey, allowedMembers = []) {
    if (!googleKey) {
      throw new Error('Missing required secure store data');
    }
    if (!lambdaQuery.code) {
      throw new Error('Missing OAuth Google code');
    }

    const storeData = googleKey.storeData.reduce((output, data) => {
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
    const clientSecret = storeData['CLIENT_SECRET'];
    const redirectURI = storeData['REDIRECT_URI'];
    if (!clientId || !redirectURI || !clientSecret) {
      throw new Error('Missing some Google credentials');
    }

    const grantType = 'authorization_code';
    const authResult = await lambda.fetch({
      url: `https://oauth2.googleapis.com/token?code=${lambdaQuery.code}&client_id=${clientId}&client_secret=${clientSecret}&redirect_uri=${redirectURI}&grantType=${grantType}`,
      options: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    });
    const accessToken = authResult.body.access_token;
    const profileResult = await lambda.fetch({
      url: 'https://openidconnect.googleapis.com/v1/userinfo',
      options: {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
      },
    });

    const profile = profileResult.body;
    const [domainsObj] = domainsKey.storeData;
    const authentication = {
      authLevel: 3,
      domains: Object.values(domainsObj),
      role: 'public',
      permissions: [
        {route: '*', permission: '*'},
      ],
    };
    let buttressUser = await Buttress.User.getUser(profile.email);
    if (!buttressUser) {
      const user = {
        app: 'google',
        id: profile.sub,
        username: profile.name,
        token: accessToken,
        refreshToken: authResult.body.refresh_token,
        email: profile.email,
        profileUrl: profile.picture,
        profileImgUrl: profile.picture,
        bannerImgUrl: '',
        locale: profile.locale,
        policyProperties: {},
      };

      // Check to see if one of the emails matches against a team email.
      const allowedMember = allowedMembers.storeData.find((t) => profile.email === t.identifierEmail && profile.email_verified);
      // Early out as this user isn't part of the team roster.
      if (!allowedMember) {
        lambda.logError(`AUTH: User ${profile.name} not part allowed list using ${profile.email}`);
        throw new Error(`AUTH: User ${profile.name} not part allowed list using ${profile.email}`);
      }
  
      const policyProperties = Object.keys(allowedMember.policySelectors).reduce((obj, key) => {
        obj[key] = allowedMember[key];
  
        return obj;
      }, {});
  
      // Early out as this user isn't part of the team roster.
      if (Object.keys(policyProperties).length < 1) {
        lambda.logError(`AUTH: User ${profile.name} does not have any policies ${profile.email}`);
        throw new Error(`AUTH: User ${profile.name} does not have any policies ${profile.email}`);
      }
  
      user.policyProperties = policyProperties;
      lambda.logDebug(`AUTH: Pending ${profile.name} using ${profile.email}`);
  
      buttressUser = await Buttress.Auth.findOrCreateUser(user, authentication);
  
      if (!buttressUser) {
        lambda.logError(`AUTH: User ${profile.name} profile doesn't exist using ${profile.email}`);
        throw new Error(`AUTH: User ${profile.name} profile doesn't exist using ${profile.email}`);
      }
  
      lambda.logDebug(`AUTH: Success ${profile.name} using ${buttressUser.id}`);
    } else {
      const index = buttressUser.auth.findIndex((a) => a.app === 'google');
      const updates = [{
        path: `auth.${index}.appId`,
        value: profile.sub,
      }, {
        path: `auth.${index}.username`,
        value: profile.name,
      }, {
        path: `auth.${index}.token`,
        value: accessToken,
      }, {
        path: `auth.${index}.profileUrl`,
        value: profile.picture,
      }, {
        path: `auth.${index}.images.profile`,
        value: profile.picture,
      }, {
        path: `auth.${index}.locale`,
        value: profile.locale,
      }];

      if (authResult.body.refresh_token) {
        updates.push({
          path: `auth.${index}.refreshToken`,
          value: authResult.body.refresh_token,
        });
      }

      await Buttress.User.update(buttressUser.id, updates);
    }

    // Check to see if tokens is empty
    if (!buttressUser.tokens || buttressUser.tokens.length < 1) {
      lambda.logDebug(`AUTH: Missing token for ${buttressUser.id}:${profile.name}`);
      const token = await Buttress.Auth.createToken(buttressUser.id, authentication);
      buttressUser.tokens.push(token);
    }

    buttressUser.service = `google`;

    return {
      user: buttressUser,
      profile: profile,
    };
  }
}

module.exports = new GoogleAuth();
