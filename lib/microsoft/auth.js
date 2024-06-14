'use strict';

const Helpers = require('../helpers/helpers');

/**
 * @class MicrosoftAuth
 */
class MicrosoftAuth {
  /**
   * Creates an instance of MicrosoftAuth
   */
  constructor() {}

  /**
   * microsoftGetOAuth2URL
   * @param {Object} microsoftKey
   * @param {string} state
   * @return {Promise}
   */
  async microsoftGetOAuth2URL(microsoftKey, state = null) {
    if (!microsoftKey) {
      const error = new Error('Missing required secure store data');
      error.code = 400;
      throw error;
    }

    const objectKeys = Object.keys(microsoftKey);
    const issuer = microsoftKey[objectKeys.find(key => key.toUpperCase() === 'ISSUER')];
    const clientId = microsoftKey[objectKeys.find(key => key.toUpperCase() === 'CLIENT_ID')];
    const redirectURI = microsoftKey[objectKeys.find(key => key.toUpperCase() === 'REDIRECT_URI')];
    const scope = microsoftKey[objectKeys.find(key => key.toUpperCase() === 'SCOPE')];
    if (!issuer || !clientId || !redirectURI || !scope) {
      const error = new Error('Missing some Microsoft credentials');
      error.code = 400;
      throw error;
    }

    const PKCEcode = await lambda.getCodeChallenge();
    const oauthState = (Math.random() + 1).toString(36).substring(7);
    const codeVerifier = PKCEcode.codeVerifier;
    const execution = await Buttress.getCollection('lambdaExecution').get(lambdaInfo.executionId);

    // state metadata
    const stateMetadata = {
      key: 'STATE',
      value: oauthState,
    };

    // code verifier metadata
    const codeVerifierMetadata = {
      key: 'CODE_VERIFIER',
      value: codeVerifier,
    }

    const updates = [{
      path: 'metadata',
      value: stateMetadata,
    }, {
      path: 'metadata',
      value: codeVerifierMetadata,
    }];

    state = (state) ? Helpers.parseQueryString(state) : null;
    if (state && typeof state === 'object' && Object.keys(state).length > 0) {
      for await (const key of Object.keys(state)) {
        const metadata = {
          key: Sugar.String.underscore(key).toUpperCase(),
          value: state[key],
        };

        updates.push({
          path: 'metadata',
          value: metadata,
        });
      }
    }

    await Buttress.getCollection('lambdaExecution').update(execution.id, updates);

    return `https://login.microsoftonline.com/${issuer}/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectURI}&response_mode=query&scope=${scope}&state=${lambdaInfo.executionId}&code_challenge=${PKCEcode.codeChallenge}&code_challenge_method=S256`;
  }

  /**
   * microsoftOAuth2Callback
   * @param {Object} microsoftKey
   * @param {Object} domainsKey
   * @param {Object} allowedMembers
   * @param {Object} tokens
   * @param {Object} profile
   * @return {Promise}
   */
  async microsoftOAuth2Callback(microsoftKey, domainsKey, allowedMembers = [], tokens = null, profile = null) {
    if (!microsoftKey) {
      const error = new Error('Missing required secure store data');
      error.code = 400;
      throw error;
      
    }
    if (!lambda.req.query.code) {
      const error = new Error('Missing OAuth Microsoft code');
      error.code = 400;
      throw error;
    }

    tokens = (!tokens) ? await this.getTokens(microsoftKey) : tokens;
    profile = (!profile) ? await this.getProfile(tokens.accessToken) : profile;

    const domainsObjectKeys = Object.keys(domainsKey);
    const appURL = domainsKey[domainsObjectKeys.find(key => key.toUpperCase() === 'APPURL')];
    const authentication = {
      domains: [appURL],
      permissions: [
        {route: '*', permission: '*'},
      ],
      policyProperties: {},
    };
    let buttressUser = null;
    try {
      const appId = profile.id;
      lambda.logDebug(`AUTH: Finding user microsoft, ${appId}`);
      buttressUser = await Buttress.User.findUser('microsoft', appId);
    } catch (err) {
      if (Sugar.String.underscore(err.message).toUpperCase().includes('NOT_FOUND')) {
        lambda.logDebug('User is not found. Creating the user');
      } else {
        throw err;
      }
    }

    if (!buttressUser) {
      // TODO: Search for user.auth.email for an existing user.
      lambda.logDebug(`AUTH: Finding user email, ${profile.mail}`);

      // Check to see if there is a user that exists with that auth email.
      [buttressUser] = await Buttress.User.search({'auth.email': profile.mail});
      if (buttressUser && buttressUser.auth.every((u) => u.email !== profile.mail)) {
        lambda.logError(`AUTH: User ${profile.givenName} found in the database is not matching the profile email ${profile.mail}`);
        const error = new Error(`AUTH: User ${profile.givenName} found in the database is not matching the profile email ${profile.mail}`);
        error.code = 404;
        throw error;
      }

      // The search user doesn't return tokens and we don't want it too. Instead
      // we'll just look up the user directly with the id, this will return
      // their tokens.
      if (buttressUser) buttressUser = await Buttress.User.get(buttressUser.id);
    }

    const userAuth = {
      app: 'microsoft',
      appId: profile.id,
      username: profile.displayName,
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      email: profile.mail,
      profileUrl: profile.picture,
      profileImgUrl: profile.picture,
      bannerImgUrl: '',
      locale: profile.locale,
    };

    if (!buttressUser) {
      buttressUser = {
        auth: [],
        token: authentication,
      }
      buttressUser.auth.push(userAuth);

      if (allowedMembers.length < 1) {
        lambda.logError(`AUTH: User ${profile.givenName} can not be authorised ${profile.mail}, the app do not have an allowed list`);
        const error = new Error(`AUTH: User ${profile.givenName} can not be authorised ${profile.mail}, the app do not have an allowed list`);
        error.code = 401;
        throw error;
      }

      // Check to see if one of the emails matches against a team email.
      const allowedMember = allowedMembers.find((t) => profile.mail === t.identifierEmail);
      // Early out as this user isn't part of the team roster.
      if (!allowedMember) {
        lambda.logError(`AUTH: User ${profile.displayName} not part allowed list using ${profile.mail}`);
        const error = new Error(`AUTH: User ${profile.displayName} not part allowed list using ${profile.mail}`);
        error.code = 401;
        throw error;
      }

      const policyProperties = Object.keys(allowedMember.policySelectors).reduce((obj, key) => {
        obj[key] = allowedMember.policySelectors[key];

        return obj;
      }, {});

      // Early out as this user isn't part of the team roster.
      if (Object.keys(policyProperties).length < 1) {
        lambda.logError(`AUTH: User ${profile.displayName} does not have any policies ${profile.mail}`);
        const error = new Error(`AUTH: User ${profile.displayName} does not have any policies ${profile.mail}`);
        error.code = 401;
        throw error;
      }

      buttressUser.token.policyProperties = policyProperties;
      lambda.logDebug(`AUTH: Pending ${profile.displayName} using ${profile.mail}`);

      buttressUser = await Buttress.User.save(buttressUser);
      lambda.logDebug(`AUTH: Success ${profile.displayName} using ${buttressUser.id}`);
    } else {
      const updates = [];
      let authIndex = buttressUser.auth.findIndex((a) => a.app === 'microsoft' && (a.appId === profile.id));

      if (authIndex === -1) {
        buttressUser.auth.push(userAuth);
        authIndex = updates.push({path: `auth`, value: userAuth});
      } else {
        // We're keying against these so don't need to updatethem.
        // updates.push({path: `auth.${authIndex}.app`, value: userAuth.app});
        // updates.push({path: `auth.${authIndex}.appId`, value: userAuth.appId});
        if (userAuth.username) updates.push({path: `auth.${authIndex}.username`, value: userAuth.username});
        if (userAuth.token) updates.push({path: `auth.${authIndex}.token`, value: userAuth.token});
        if (userAuth.profileUrl) updates.push({path: `auth.${authIndex}.profileUrl`, value: userAuth.profileUrl});
        if (userAuth.profileImgUrl) updates.push({path: `auth.${authIndex}.images.profile`, value: userAuth.profileImgUrl});
        if (userAuth.locale) updates.push({path: `auth.${authIndex}.locale`, value: userAuth.locale});
        if (userAuth.refreshToken) updates.push({path: `auth.${authIndex}.refreshToken`, value: userAuth.refreshToken});
      }

      await Buttress.User.update(buttressUser.id, updates);
    }

    // Check to see if tokens is empty
    if (!buttressUser.token && (!buttressUser.tokens || (buttressUser.tokens && buttressUser.tokens.length < 1))) {
      // Check to see if one of the emails matches against a team email.
      const allowedMember = allowedMembers.find((t) => profile.mail === t.identifierEmail);
      // Early out as this user isn't part of the team roster.
      if (!allowedMember) {
        lambda.logError(`AUTH: User ${profile.name} not part allowed list using ${profile.mail}`);
        const error = new Error(`AUTH: User ${profile.name} not part allowed list using ${profile.mail}`);
        error.code = 401;
        throw error;
      }

      const policyProperties = Object.keys(allowedMember.policySelectors).reduce((obj, key) => {
        obj[key] = allowedMember.policySelectors[key];

        return obj;
      }, {});

      authentication.policyProperties = policyProperties;
      lambda.logDebug(`AUTH: Missing token for ${buttressUser.id}:${profile.name}`);
      const token = await Buttress.Auth.createToken(buttressUser.id, authentication);
      buttressUser.tokens = [token];
    }

    buttressUser.service = `microsoft`;
    if ((!buttressUser.tokens || (buttressUser.tokens && buttressUser.tokens.length < 1)) && buttressUser.token) {
      buttressUser.tokens = [buttressUser.token];
      delete buttressUser.token
    }

    return {
      user: buttressUser,
      profile: profile,
    };
  }

  /**
   * getTokens
   * @param {Object} microsoftKey
   * @return {Object}
   */
  async getTokens(microsoftKey) {
    try {
      const microsoftAuthLambdaExecution = await Buttress.getCollection('lambdaExecution').get(lambda.req.query.state);
      if (!microsoftAuthLambdaExecution) {
        const error = new Error(`Can not find the microsoft lambda execution ${lambda.req.query.state}`);
        error.code = 404;
        throw error;
      }

      const state = microsoftAuthLambdaExecution.metadata.find((m) => m.key === 'STATE');
      const codeVerifier = microsoftAuthLambdaExecution.metadata.find((m) => m.key === 'CODE_VERIFIER');
      if (!state) {
        const error = new Error('Can not find request state within lambda');
        error.code = 404;
        throw error;
      }
      if (!codeVerifier) {
        const error = new Error('Can not find request code verifier within the lambda');
        error.code = 404;
        throw error;
      }
  
      const microsoftObjectKeys = Object.keys(microsoftKey);
      const issuer = microsoftKey[microsoftObjectKeys.find(key => key.toUpperCase() === 'ISSUER')];
      const clientId = microsoftKey[microsoftObjectKeys.find(key => key.toUpperCase() === 'CLIENT_ID')];
      const clientSecret = microsoftKey[microsoftObjectKeys.find(key => key.toUpperCase() === 'CLIENT_SECRET')];
      const redirectURI = microsoftKey[microsoftObjectKeys.find(key => key.toUpperCase() === 'REDIRECT_URI')];
      const scope = microsoftKey[microsoftObjectKeys.find(key => key.toUpperCase() === 'SCOPE')];
      if (!issuer || !clientId || !clientSecret || !redirectURI || !scope) {
        const error = new Error('Missing some Microsoft credentials');
        error.code = 400;
        throw error;
      }
  
      const grantType = 'authorization_code';
  
      const authResult = await lambda.fetch({
        url: `https://login.microsoftonline.com/${issuer}/oauth2/v2.0/token`,
        options: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: {
            code: lambda.req.query.code,
            client_id: clientId,
            grant_type: grantType,
            scope: scope,
            redirect_uri: redirectURI,
            code_verifier: codeVerifier.value,
            client_secret: clientSecret,
          }
        },
      });

      return {
        accessToken: authResult.body.access_token,
        refreshToken: authResult.body.refresh_token,
      }
    } catch (err) {
      throw err;
    }
  }

  /**
   * getProfile
   * @param {string} accessToken
   * @return {Object}
   */
  async getProfile(accessToken) {
    try {
      const profileRes = await lambda.fetch({
        url: 'https://graph.microsoft.com/v1.0/me',
        options: {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      });

      return profileRes.body;
    } catch (err) {
      throw err;
    }
  }
}

module.exports = new MicrosoftAuth();
