'use strict';

/**
 * @class CompaniesHouseAuth
 */
class CompaniesHouseAuth {
  /**
   * Creates an instance of CompaniesHouseAuth
   */
  constructor() {}

  /**
   * companiesHouseGetOAuth2URL
   * @param {string} clientId get from companies-house developer platform
   * @param {string} redirectURI url for oauth callback
   * @param {array} scopes array of scopes strings
   * @return {Promise}
   */
  async companiesHouseGetOAuth2URL(clientId, redirectURI, scopes) {
    if (!clientId || !redirectURI || !scopes) {
      throw new Error('Missing some Companies House credentials');
    }

    const scopesStr = scopes.join(' ');

    return `https://identity.company-information.service.gov.uk/oauth2/authorise?client_id=${clientId}&redirect_uri=${redirectURI}&scope=${scopesStr}&response_type=code`;
  }

  /**
   * companiesHouseOAuth2Callback
   * @param {Object} companiesHouseKey
   * @param {Object} domainsKey
   * @param {Object} allowedMembers
   * @return {Promise}
   */
  async companiesHouseOAuth2Callback(companiesHouseKey, domainsKey, allowedMembers = []) {
    if (!companiesHouseKey) {
        throw new Error('Missing required secure store data');
    }
    if (!lambda.req.query.code) {
      throw new Error('Missing OAuth Companies House code');
    }

    const clientId = companiesHouseKey.getValue('CLIENT_ID');
    const clientSecret = companiesHouseKey.getValue('CLIENT_SECRET');
    const redirectURI = companiesHouseKey.getValue('REDIRECT_URI');
    if (!clientId || !redirectURI || !clientSecret) {
      throw new Error('Missing some Companies House credentials');
    }

    const authResult = await lambda.fetch({
      url: `https://identity.company-information.service.gov.uk/oauth2/token`,
      options: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: {
          code: lambda.req.query.code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectURI,
          grant_type: 'authorization_code',
        }
      },
    });

    const accessToken = authResult.body.access_token;
    const profileResult = await lambda.fetch({
      url: 'https://identity.company-information.service.gov.uk/user/profile',
      options: {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
      },
    });

    const profile = profileResult.body;
    const appURL = domainsKey.getValue('appURL');
    const authentication = {
      authLevel: 3,
      domains: [appURL],
      role: 'public',
      permissions: [
        {route: '*', permission: '*'},
      ],
    };

    let buttressUser = await Buttress.User.getUser(profile.email);
    if (!buttressUser) {
      buttressUser = {
        auth: [],
        policyProperties: {},
      };

      buttressUser.auth.push({
        app: 'companies-house',
        appId: profile.id,
        username: `${profile.forename} ${profile.surname}`,
        token: accessToken,
        refreshToken: authResult.body.refresh_token,
        email: profile.email,
        profileUrl: null,
        profileImgUrl: null,
        bannerImgUrl: null,
        locale: profile.locale,
      });

      if (allowedMembers.length < 1) {
        lambda.logError(`AUTH: User ${profile.forename} can not be authorised ${profile.email}, the app do not have an allowed list`);
        throw new Error(`AUTH: User ${profile.forename} can not be authorised ${profile.email}, the app do not have an allowed list`);
      }

      // Check to see if one of the emails matches against a team email.
      const allowedList = allowedMembers.getValue('list');
      const allowedMember = allowedList.find((t) => profile.email === t.identifierEmail);
      // Early out as this user isn't part of the team roster.
      if (!allowedMember) {
        lambda.logError(`AUTH: User ${profile.forename} not part allowed list using ${profile.email}`);
        throw new Error(`AUTH: User ${profile.forename} not part allowed list using ${profile.email}`);
      }

      const policyProperties = Object.keys(allowedMember.policySelectors).reduce((obj, key) => {
        obj[key] = allowedMember.policySelectors[key];

        return obj;
      }, {});

      // Early out as this user isn't part of the team roster.
      if (Object.keys(policyProperties).length < 1) {
        lambda.logError(`AUTH: User ${profile.forename} does not have any policies ${profile.email}`);
        throw new Error(`AUTH: User ${profile.forename} does not have any policies ${profile.email}`);
      }

      buttressUser.policyProperties = policyProperties;
      lambda.logDebug(`AUTH: Pending ${profile.forename} using ${profile.email}`);

      buttressUser = await Buttress.User.save(buttressUser);
      lambda.logDebug(`AUTH: Success ${profile.forename} using ${buttressUser.id}`);
    } else {
      const index = buttressUser.auth.findIndex((a) => a.app === 'companies-house');
      const updates = [{
        path: `auth.${index}.appId`,
        value: profile.id,
      }, {
        path: `auth.${index}.username`,
        value: `${profile.forename} ${profile.surname}`,
      }, {
        path: `auth.${index}.token`,
        value: accessToken,
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
    if (!buttressUser.token) {
      lambda.logDebug(`AUTH: Missing token for ${buttressUser.id}:${profile.forename}`);
      const token = await Buttress.Auth.createToken(buttressUser.id, authentication);
      buttressUser.token = token?.value;
    }

    buttressUser.service = `companies-house`;

    return {
      user: buttressUser,
      profile: profile,
    };
  }
}

module.exports = new CompaniesHouseAuth();
