'use strict';

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
   * @return {Promise}
   */
  async microsoftGetOAuth2URL(microsoftKey) {
    if (!microsoftKey) {
      throw new Error('Missing required secure store data');
    }

    const objectKeys = Object.keys(microsoftKey);
    const issuer = microsoftKey[objectKeys.find(key => key.toUpperCase() === 'ISSUER')];
    const clientId = microsoftKey[objectKeys.find(key => key.toUpperCase() === 'CLIENT_ID')];
    const redirectURI = microsoftKey[objectKeys.find(key => key.toUpperCase() === 'REDIRECT_URI')];
    const scope = microsoftKey[objectKeys.find(key => key.toUpperCase() === 'SCOPE')];
    if (!issuer || !clientId || !redirectURI || !scope) {
      throw new Error('Missing some Microsoft credentials');
    }

    const PKCEcode = await lambda.getCodeChallenge();
    const state = (Math.random() + 1).toString(36).substring(7);
    const codeVerifier = PKCEcode.codeVerifier;
    const stateIdx = lambdaInfo.metadata.findIndex((m) => m.key === 'STATE');
    const codeVerifierIdx = lambdaInfo.metadata.findIndex((m) => m.key === 'CODE_VERIFIER');
    await lambdaAPI('updateMetadata', {
      id: lambdaInfo.lambdaId,
      key:'STATE',
      value: state,
      idx: stateIdx
    });
    await lambdaAPI('updateMetadata', {
      id: lambdaInfo.lambdaId,
      key: 'CODE_VERIFIER',
      value: codeVerifier,
      idx: codeVerifierIdx,
    });

    return `https://login.microsoftonline.com/${issuer}/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectURI}&response_mode=query&scope=${scope}&state=${state}&code_challenge=${PKCEcode.codeChallenge}&code_challenge_method=S256`;
  }

  /**
   * microsoftOAuth2Callback
   * @param {Object} microsoftKey
   * @param {Object} domainsKey
   * @param {Object} allowedMembers
   * @return {Promise}
   */
  async microsoftOAuth2Callback(microsoftKey, domainsKey, allowedMembers = []) {
    if (!microsoftKey) {
      throw new Error('Missing required secure store data');
    }
    if (!lambda.req.query.code) {
      throw new Error('Missing OAuth Microsoft code');
    }

    const [microsoftAuthLambda] = await Buttress.getCollection('lambda').search({
      name: 'microsoft-auth',
    });
    if (!microsoftAuthLambda) {
      throw new Error('Can not access the metadata of microsoft auth lambda');
    }
    const state = microsoftAuthLambda.metadata.find((m) => m.key === 'STATE');
    const codeVerifier = microsoftAuthLambda.metadata.find((m) => m.key === 'CODE_VERIFIER');
    if (!state || (state && state.value !== lambda.req.query.state)) {
      throw new Error('State request and state response do not match');
    }
    if (!codeVerifier) {
      throw new Error('Can not access request code verifier');
    }

    const microsoftObjectKeys = Object.keys(microsoftKey);
    const issuer = microsoftKey[microsoftObjectKeys.find(key => key.toUpperCase() === 'ISSUER')];
    const clientId = microsoftKey[microsoftObjectKeys.find(key => key.toUpperCase() === 'CLIENT_ID')];
    const clientSecret = microsoftKey[microsoftObjectKeys.find(key => key.toUpperCase() === 'CLIENT_SECRET')];
    const redirectURI = microsoftKey[microsoftObjectKeys.find(key => key.toUpperCase() === 'REDIRECT_URI')];
    const scope = microsoftKey[microsoftObjectKeys.find(key => key.toUpperCase() === 'SCOPE')];
    if (!issuer || !clientId || !clientSecret || !redirectURI || !scope) {
      throw new Error('Missing some Google credentials');
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

    const accessToken = authResult.body.access_token;
    const profileRes = await lambda.fetch({
      url: 'https://graph.microsoft.com/v1.0/me',
      options: {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    });

    const profile = profileRes.body;

    const domainsObjectKeys = Object.keys(domainsKey);
    const appURL = domainsKey[domainsObjectKeys.find(key => key.toUpperCase() === 'APPURL')];
    const buttressURL = domainsKey[domainsObjectKeys.find(key => key.toUpperCase() === 'BUTTRESSURL')];
    const authentication = {
      authLevel: authLevel,
      domains: [appURL, buttressURL],
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
      }
      buttressUser.auth.push({
        app: 'microsoft',
        appId: profile.id,
        username: profile.displayName,
        token: accessToken,
        refreshToken: authResult.body.refresh_token,
        email: profile.mail,
        profileUrl: profile.picture,
        profileImgUrl: profile.picture,
        bannerImgUrl: '',
        locale: profile.locale,
      });

      if (allowedMembers.length < 1) {
        lambda.logError(`AUTH: User ${profile.forename} can not be authorised ${profile.email}, the app do not have an allowed list`);
        throw new Error(`AUTH: User ${profile.forename} can not be authorised ${profile.email}, the app do not have an allowed list`);
      }

      // Check to see if one of the emails matches against a team email.
      const allowedMember = allowedMembers.find((t) => profile.mail === t.email);
      // Early out as this user isn't part of the team roster.
      if (!allowedMember) {
        lambda.logError(`AUTH: User ${profile.displayName} not part allowed list using ${profile.mail}`);
        throw new Error(`AUTH: User ${profile.displayName} not part allowed list using ${profile.mail}`);
      }

      const policyProperties = Object.keys(allowedMember.policySelectors).reduce((obj, key) => {
        obj[key] = allowedMember.policySelectors[key];

        return obj;
      }, {});

      // Early out as this user isn't part of the team roster.
      if (Object.keys(policyProperties).length < 1) {
        lambda.logError(`AUTH: User ${profile.displayName} does not have any policies ${profile.mail}`);
        throw new Error(`AUTH: User ${profile.displayName} does not have any policies ${profile.mail}`);
      }

      buttressUser.policyProperties = policyProperties;
      lambda.logDebug(`AUTH: Pending ${profile.displayName} using ${profile.mail}`);

      buttressUser = await Buttress.User.save(buttressUser);
      lambda.logDebug(`AUTH: Success ${profile.displayName} using ${buttressUser.id}`);
    } else {
      const index = buttressUser.auth.findIndex((a) => a.app === 'microsoft');
      const updates = [{
        path: `auth.${index}.appId`,
        value: profile.id,
      }, {
        path: `auth.${index}.token`,
        value: accessToken,
      }, {
        path: `auth.${index}.profileUrl`,
        value: profile.picture,
      }, {
        path: `auth.${index}.profileImgUrl`,
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
    if (!buttressUser.token) {
      lambda.logDebug(`AUTH: Missing token for ${buttressUser.id}:${profile.displayName}`);
      const token = await Buttress.Auth.createToken(buttressUser.id, authentication);
      buttressUser.token = token?.value;
    }

    buttressUser.service = `microsoft`;

    return {
      user: buttressUser,
      profile: profile,
    };
  }
}

module.exports = new MicrosoftAuth();
