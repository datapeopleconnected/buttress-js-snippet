'use strict';

const Helpers = require('../helpers/helpers');

/**
 * @class HMRCAuth
 */
class HMRCAuth {
  /**
   * Creates an instance of HMRCAuth
   */
  constructor() {}

  /**
   * HMRCAuthGetOAuth2URL
   * @param {Object} HMRCKey
   * @param {string} scope
   * @param {string} state
   * @return {Promise}
   */
  async HMRCAuthGetOAuth2URL(HMRCKey, scope = null, state = null) {
    if (!HMRCKey) {
      const error = new Error('Missing required secure store data');
      error.code = 400;
      throw error;
    }

    const objectKeysHMRC = Object.keys(HMRCKey);
    const clientId = HMRCKey[objectKeysHMRC.find(key => key.toUpperCase() === 'CLIENT_ID')];
    const redirectURI = encodeURIComponent(HMRCKey[objectKeysHMRC.find(key => key.toUpperCase() === 'REDIRECT_URI')]);
    scope = (scope) ? scope : HMRCKey[objectKeysHMRC.find(key => key.toUpperCase() === 'SCOPE')];
    if (!clientId || !redirectURI || !scope) {
      const error = new Error('Missing some HMRC credentials');
      error.code = 400;
      throw error;
    }

    const execution = await Buttress.getCollection('lambdaExecution').get(lambdaInfo.executionId);
    state = (state) ? Helpers.parseQueryString(state) : null;
    const updates = [];
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
    let url = `https://www.tax.service.gov.uk`;
    if (lambda.env === 'DEV') {
      url = `https://test-www.tax.service.gov.uk`;
    }

    return `${url}/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectURI}&scope=${scope}&response_type=code&state=${lambdaInfo.executionId}`;
  }

  /**
   * HMRCOAuth2Callback
   * @param {Object} HMRCKey
   * @param {Object} domainsKey
   * @param {Object} allowedMembers
   * @return {Promise}
   */
  async HMRCOAuth2Callback(HMRCKey, domainsKey, allowedMembers = [], user = null) {
    try {
      if (!HMRCKey) {
        const error = new Error('Missing required secure store data');
        error.code = 400;
        throw error;
      }
      if (!lambda.req.query.code) {
        const error = new Error('Missing OAuth HMRC code');
        error.code = 400;
        throw error;
      }

      const objectKeysHMRC = Object.keys(HMRCKey);
      const clientId = HMRCKey[objectKeysHMRC.find(key => key.toUpperCase() === 'CLIENT_ID')];
      const clientSecret = HMRCKey[objectKeysHMRC.find(key => key.toUpperCase() === 'CLIENT_SECRET')];
      const redirectURI = encodeURIComponent(HMRCKey[objectKeysHMRC.find(key => key.toUpperCase() === 'REDIRECT_URI')]);
      if (!clientId || !redirectURI || !clientSecret) {
        const error = new Error('Missing some HMRC credentials');
        error.code = 400;
        throw error;
      }

      let url = `https://api.service.hmrc.gov.uk`;
      if (lambda.env === 'DEV') {
        url = `https://test-api.service.hmrc.gov.uk`;
      }

      let authResult = null;
      authResult = await lambda.fetch({
        url: `${url}/oauth/token`,
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

      const domainsObjectKeys = Object.keys(domainsKey);
      const appURL = domainsKey[domainsObjectKeys.find(key => key.toUpperCase() === 'APPURL')];
      const authentication = {
        domains: [appURL],
        permissions: [
          {route: '*', permission: '*'},
        ],
        policyProperties: {},
      };
      const tokens = {
        accessToken: authResult.body.access_token,
        refreshToken: authResult.body.refresh_token,
      }


      const userAuth = {
        app: 'hmrc',
        appId: '',
        username: '',
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        email: '',
        profileUrl: '',
        profileImgUrl: '',
        bannerImgUrl: '',
        locale: '',
      };

      let buttressUser = (user) ? user : null;
      if (!buttressUser) {
        buttressUser = {
          auth: [],
          token: authentication,
        }
        buttressUser.auth.push(userAuth);

        buttressUser = await Buttress.User.save(buttressUser);
        lambda.logDebug(`AUTH: Success using ${buttressUser.id}`);
      } else {
        const updates = [];
        let authIndex = buttressUser.auth.findIndex((a) => a.app === 'hmrc');

        if (authIndex === -1) {
          authIndex = updates.push({path: `auth`, value: userAuth});
        } else {
          // We're keying against these so don't need to updatethem.
          // updates.push({path: `auth.${authIndex}.app`, value: userAuth.app});
          // updates.push({path: `auth.${authIndex}.appId`, value: userAuth.appId});
          if (userAuth.token) updates.push({path: `auth.${authIndex}.token`, value: userAuth.token});
          if (userAuth.refreshToken) updates.push({path: `auth.${authIndex}.refreshToken`, value: userAuth.refreshToken});
        }

        await Buttress.User.update(buttressUser.id, updates);
      }


      buttressUser.service = `hmrc`;
      if ((!buttressUser.tokens || (buttressUser.tokens && buttressUser.tokens.length < 1)) && buttressUser.token) {
        buttressUser.tokens = [buttressUser.token];
        delete buttressUser.token
      }

      return {
        user: buttressUser,
      };
    } catch (err) {
      lambda.log(JSON.stringify(err));
      throw err;
    }
  }
}

module.exports = new HMRCAuth();
