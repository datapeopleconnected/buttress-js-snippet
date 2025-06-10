'use strict';

/**
 * Buttress - The federated real-time open data platform
 * Copyright (C) 2016-2024 Data People Connected LTD.
 * <https://www.dpc-ltd.com/>
 *
 * This file is part of Buttress.
 * Buttress is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public Licence as published by the Free Software
 * Foundation, either version 3 of the Licence, or (at your option) any later version.
 * Buttress is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU Affero General Public Licence for more details.
 * You should have received a copy of the GNU Affero General Public Licence along with
 * this program. If not, see <http://www.gnu.org/licenses/>.
 */

const Helpers = require('../helpers/helpers');

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
   * @param {string} nodeEnv
   * @param {Object} companiesHouseKey
   * @param {string} scope
   * @param {string} state
   * @return {Promise}
   */
  async companiesHouseGetOAuth2URL(nodeEnv, companiesHouseKey, scope = null, state = null) {
    if (!companiesHouseKey) {
      const error = new Error('Missing required secure store data');
      error.code = 400;
      throw error;
    }

    const objectKeysCH = Object.keys(companiesHouseKey);
    const clientId = companiesHouseKey[objectKeysCH.find(key => key.toUpperCase() === 'CLIENT_ID')];
    const redirectURI = companiesHouseKey[objectKeysCH.find(key => key.toUpperCase() === 'REDIRECT_URI')];
    scope = (scope) ? scope : companiesHouseKey[objectKeysCH.find(key => key.toUpperCase() === 'SCOPE')];
    if (!clientId || !redirectURI || !scope) {
      const error = new Error('Missing some Companies House credentials');
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
    let url = `https://identity-sandbox.company-information.service.gov.uk`;
    if (nodeEnv && nodeEnv === 'PRODUCTION') {
      url = `https://identity.company-information.service.gov.uk`;
    }

    return `${url}/oauth2/authorise?client_id=${clientId}&redirect_uri=${redirectURI}&scope=${scope}&response_type=code&state=${lambdaInfo.executionId}`;
  }

  /**
   * companiesHouseOAuth2Callback
   * @param {string} nodeEnv
   * @param {Object} companiesHouseKey
   * @param {Object} domainsKey
   * @param {Object} allowedMembers
   * @return {Promise}
   */
  async companiesHouseOAuth2Callback(nodeEnv, companiesHouseKey, domainsKey, allowedMembers = [], user = null) {
    try {
      if (!companiesHouseKey) {
        const error = new Error('Missing required secure store data');
        error.code = 400;
        throw error;
      }
      if (!lambda.req.query.code) {
        const error = new Error('Missing OAuth Companies House code');
        error.code = 400;
        throw error;
      }

      const objectKeysCH = Object.keys(companiesHouseKey);
      const clientId = companiesHouseKey[objectKeysCH.find(key => key.toUpperCase() === 'CLIENT_ID')];
      const clientSecret = companiesHouseKey[objectKeysCH.find(key => key.toUpperCase() === 'CLIENT_SECRET')];
      const redirectURI = companiesHouseKey[objectKeysCH.find(key => key.toUpperCase() === 'REDIRECT_URI')];
      if (!clientId || !redirectURI || !clientSecret) {
        const error = new Error('Missing some Companies House credentials');
        error.code = 400;
        throw error;
      }

      let url = `https://identity-sandbox.company-information.service.gov.uk`;
      if (nodeEnv && nodeEnv === 'PRODUCTION') {
        url = `https://identity.company-information.service.gov.uk`;
      }

      let authResult = null;
      authResult = await lambda.fetch({
        url: `${url}/oauth2/token`,
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

      const tokens = {
        accessToken: authResult.body.access_token,
        refreshToken: authResult.body.refresh_token,
      }

      const profileResult = await lambda.fetch({
        url: `${url}/user/profile`,
        options: {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${tokens.accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
          },
        },
      });

      const profile = profileResult.body;
      const domainsObjectKeys = Object.keys(domainsKey);
      const appURL = domainsKey[domainsObjectKeys.find(key => key.toUpperCase() === 'APPURL')];
      const authentication = {
        domains: [appURL],
        permissions: [
          {route: '*', permission: '*'},
        ],
        policyProperties: {},
      };

      const username = (profile.forename && profile.surname) ? `${profile.forename} ${profile.surname}` : (profile.forename) ? profile.forename : (profile.surname) ? profile.surname : '';
      const userAuth = {
        app: 'companies-house',
        appId: profile.id,
        username: username,
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        email: profile.email,
        profileUrl: '',
        profileImgUrl: '',
        bannerImgUrl: '',
        locale: profile.locale,
      };

      let buttressUser = (user) ? user : await Buttress.User.getUser(profile.email);
      if (!buttressUser) {
        buttressUser = {
          auth: [],
          token: authentication,
        }
        buttressUser.auth.push(userAuth);
  
        if (allowedMembers.length < 1) {
          lambda.logError(`AUTH: User ${profile.forename} can not be authorised ${profile.email}, the app do not have an allowed list`);
          const error = new Error(`AUTH: User ${profile.forename} can not be authorised ${profile.email}, the app do not have an allowed list`);
          error.code = 401;
          throw error;
        }
  
        // Check to see if one of the emails matches against a team email.
        const allowedMember = allowedMembers.find((t) => profile.email === t.identifierEmail);
        // Early out as this user isn't part of the team roster.
        if (!allowedMember) {
          lambda.logError(`AUTH: User ${profile.forename} not part allowed list using ${profile.email}`);
          const error = new Error(`AUTH: User ${profile.forename} not part allowed list using ${profile.email}`);
          error.code = 401;
          throw error;
        }
  
        const policyProperties = Object.keys(allowedMember.policySelectors).reduce((obj, key) => {
          obj[key] = allowedMember.policySelectors[key];
  
          return obj;
        }, {});
  
        // Early out as this user isn't part of the team roster.
        if (Object.keys(policyProperties).length < 1) {
          lambda.logError(`AUTH: User ${profile.forename} does not have any policies ${profile.email}`);
          const error = new Error(`AUTH: User ${profile.forename} does not have any policies ${profile.email}`);
          error.code = 401;
          throw error;
        }
  
        buttressUser.token.policyProperties = policyProperties;
        lambda.logDebug(`AUTH: Pending ${profile.name} using ${profile.email}`);
  
        buttressUser = await Buttress.User.save(buttressUser);
        lambda.logDebug(`AUTH: Success ${profile.name} using ${buttressUser.id}`);
      } else {
        const updates = [];
        let authIndex = buttressUser.auth.findIndex((a) => a.app === 'companies-house' && (a.appId === profile.id));

        if (authIndex === -1) {
          buttressUser.auth.push(userAuth);
          authIndex = updates.push({path: `auth`, value: userAuth});
        } else {
          // We're keying against these so don't need to updatethem.
          // updates.push({path: `auth.${authIndex}.app`, value: userAuth.app});
          // updates.push({path: `auth.${authIndex}.appId`, value: userAuth.appId});
          if (userAuth.username) updates.push({path: `auth.${authIndex}.username`, value: username});
          if (userAuth.token) updates.push({path: `auth.${authIndex}.token`, value: userAuth.token});
          if (userAuth.locale) updates.push({path: `auth.${authIndex}.locale`, value: userAuth.locale});
          if (userAuth.refreshToken) updates.push({path: `auth.${authIndex}.refreshToken`, value: userAuth.refreshToken});
        }

        await Buttress.User.update(buttressUser.id, updates);
      }

      // Check to see if tokens is empty
      if (!buttressUser.token && (!buttressUser.tokens || (buttressUser.tokens && buttressUser.tokens.length < 1))) {
        // Check to see if one of the emails matches against a team email.
        const allowedMember = allowedMembers.find((t) => profile.email === t.identifierEmail);
        // Early out as this user isn't part of the team roster.
        if (!allowedMember) {
          lambda.logError(`AUTH: User ${profile.forename} not part allowed list using ${profile.email}`);
          const error = new Error(`AUTH: User ${profile.forename} not part allowed list using ${profile.email}`);
          error.code = 401;
          throw error;
        }

        const policyProperties = Object.keys(allowedMember.policySelectors).reduce((obj, key) => {
          obj[key] = allowedMember.policySelectors[key];

          return obj;
        }, {});

        authentication.policyProperties = policyProperties;
        lambda.logDebug(`AUTH: Missing token for ${buttressUser.id}:${profile.forename}`);
        const token = await Buttress.Auth.createToken(buttressUser.id, authentication);
        buttressUser.tokens = [token];
      }

      buttressUser.service = `companies-house`;
      if ((!buttressUser.tokens || (buttressUser.tokens && buttressUser.tokens.length < 1)) && buttressUser.token) {
        buttressUser.tokens = [buttressUser.token];
        delete buttressUser.token
      }

      return {
        user: buttressUser,
        profile: profile,
      };
    } catch (err) {
      lambda.log(JSON.stringify(err));
      throw err;
    }
  }
}

module.exports = new CompaniesHouseAuth();
