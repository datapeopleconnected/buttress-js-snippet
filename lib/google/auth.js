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
   * @param {string} state
   * @param {boolean} consent
   * @return {Promise}
   */
  async googleGetOAuth2URL(googleKey, state = null, consent = false) {
    if (!googleKey) {
      const error = new Error('Missing required secure store data');
      error.code = 400;
      throw error;
    }

    const objectKeys = Object.keys(googleKey);
    const clientId = googleKey[objectKeys.find(key => key.toUpperCase() === 'CLIENT_ID')];
    const redirectURI = googleKey[objectKeys.find(key => key.toUpperCase() === 'REDIRECT_URI')];
    const scope = googleKey[objectKeys.find(key => key.toUpperCase() === 'SCOPE')];
    if (!clientId || !redirectURI || !scope) {
      const error = new Error('Missing some Google credentials');
      error.code = 400;
      throw error;
    }

    const includeGrantedScopes = true;
    const responseType = 'code';
    const accessType = 'offline';

    const execution = await Buttress.getCollection('lambda-execution').get(lambdaInfo.executionId);

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

    await Buttress.getCollection('lambda-execution').update(execution.id, updates);

    let query = {
      client_id: clientId,
      redirect_uri: redirectURI,
      include_granted_scopes: includeGrantedScopes,
      response_type: responseType,
      scope: scope,
      access_type: accessType,
      state: lambdaInfo.executionId,
    };
    if (consent) {
      query['prompt'] = 'consent';
    } else {
      query['approval_prompt'] = 'force';
    }

    query = Object.keys(query)
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`)
      .join('&');

    return `https://accounts.google.com/o/oauth2/v2/auth/identifier?${query}`;
  }

  /**
   * googleOAuth2Callback
   * @param {Object} googleKey
   * @param {Object} domainsKey
   * @param {Object} allowedMembers
   * @param {Object} tokens
   * @param {Object} profile
   * @return {Promise}
   */
  async googleOAuth2Callback(googleKey, domainsKey, allowedMembers = [], tokens = null, profile = null) {
    if (!googleKey) {
      const error = new Error('Missing required secure store data');
      error.code = 400;
      throw error;
    }
    if (!lambda.req.query.code) {
      const error = new Error('Missing OAuth Google code');
      error.code = 400;
      throw error;
    }

    tokens = (!tokens) ? await this.getTokens(googleKey) : tokens;
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
      const appId = profile.sub;
      lambda.logDebug(`AUTH: Finding user google, ${appId}`);
      buttressUser = await Buttress.User.findUser('google', appId);
    } catch (err) {
      if (Sugar.String.underscore(err.message).toUpperCase().includes('NOT_FOUND')) {
        lambda.logDebug('User is not found. Creating the user');
      } else {
        throw err;
      }
    }

    if (!buttressUser) {
      // TODO: Search for user.auth.email for an existing user.
      lambda.logDebug(`AUTH: Finding user email, ${profile.email}`);

      // Check to see if there is a user that exists with that auth email.
      [buttressUser] = await Buttress.User.search({'auth.email': profile.email});
      if (buttressUser && buttressUser.auth.every((u) => u.email !== profile.email)) {
        lambda.logError(`AUTH: User ${profile.name} found in the database is not matching the profile email ${profile.email}`);
        const error = new Error(`AUTH: User ${profile.name} found in the database is not matching the profile email ${profile.email}`);
        error.code = 404;
        throw error;
      }

      // The search user doesn't return tokens and we don't want it too. Instead
      // we'll just look up the user directly with the id, this will return
      // their tokens.
      if (buttressUser) buttressUser = await Buttress.User.get(buttressUser.id);
    }

    const userAuth = {
      app: 'google',
      appId: profile.sub,
      username: profile.name,
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      email: profile.email,
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
        lambda.logError(`AUTH: User ${profile.name} can not be authorised ${profile.email}, the app do not have an allowed list`);
        const error = new Error(`AUTH: User ${profile.name} can not be authorised ${profile.email}, the app do not have an allowed list`);
        error.code = 401;
        throw error;
      }

      // Check to see if one of the emails matches against a team email.
      const allowedMember = allowedMembers.find((t) => profile.email === t.identifierEmail && profile.email_verified);
      // Early out as this user isn't part of the team roster.
      if (!allowedMember) {
        lambda.logError(`AUTH: User ${profile.name} not part allowed list using ${profile.email}`);
        const error = new Error(`AUTH: User ${profile.name} not part allowed list using ${profile.email}`);
        error.code = 401;
        throw error;
      }

      const policyProperties = Object.keys(allowedMember.policySelectors).reduce((obj, key) => {
        obj[key] = allowedMember.policySelectors[key];

        return obj;
      }, {});

      // Early out as this user isn't part of the team roster.
      if (Object.keys(policyProperties).length < 1) {
        lambda.logError(`AUTH: User ${profile.name} does not have any policies ${profile.email}`);
        const error = new Error(`AUTH: User ${profile.name} does not have any policies ${profile.email}`);
        error.code = 401;
        throw error;
      }

      buttressUser.token.policyProperties = policyProperties;
      lambda.logDebug(`AUTH: Pending ${profile.name} using ${profile.email}`);

      buttressUser = await Buttress.User.save(buttressUser);
      lambda.logDebug(`AUTH: Success ${profile.name} using ${buttressUser.id}`);
    } else {
      const updates = [];
      let authIndex = buttressUser.auth.findIndex((a) => a.app === 'google' && (a.appId === profile.sub));

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
      const allowedMember = allowedMembers.find((t) => profile.email === t.identifierEmail && profile.email_verified);
      // Early out as this user isn't part of the team roster.
      if (!allowedMember) {
        lambda.logError(`AUTH: User ${profile.name} not part allowed list using ${profile.email}`);
        const error = new Error(`AUTH: User ${profile.name} not part allowed list using ${profile.email}`);
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

    buttressUser.service = `google`;
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
   * @param {Object} googleKey
   * @return {Object}
   */
  async getTokens(googleKey) {
    try {
      const googleObjectKeys = Object.keys(googleKey);
      const clientId = googleKey[googleObjectKeys.find(key => key.toUpperCase() === 'CLIENT_ID')];
      const clientSecret = googleKey[googleObjectKeys.find(key => key.toUpperCase() === 'CLIENT_SECRET')];
      const redirectURI = googleKey[googleObjectKeys.find(key => key.toUpperCase() === 'REDIRECT_URI')];
      if (!clientId || !redirectURI || !clientSecret) {
        const error = new Error('Missing some Google credentials');
        error.code = 400;
        throw error;
      }
  
      const grantType = 'authorization_code';
      const authResult = await lambda.fetch({
        url: `https://oauth2.googleapis.com/token?code=${lambda.req.query.code}&client_id=${clientId}&client_secret=${clientSecret}&redirect_uri=${redirectURI}&grantType=${grantType}`,
        options: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
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
  
      return profileResult.body;
    } catch (err) {
      throw err;
    }
  }
}

module.exports = new GoogleAuth();
