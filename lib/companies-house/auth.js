'use strict';

/**
 * Buttress - The federated real-time open data platform
 * Copyright (C) 2016-2025 Data People Connected LTD.
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
  constructor() {
    this.__OAUTH_CALLBACK_ERROR_MESSAGES = {
      // oAuth errors
      ACCESS_DENIED: 'You declined access to Companies House — please sign in again and approve the request so we can verify your company.',
      UNSUPPORTED_RESPONSE_TYPE: 'Companies House does not support this sign-in method.',
      INVALID_CLIENT: 'Connection failed — our Companies House credentials are invalid or missing. Please contact nodeStream admin.',
      UNSUPPORTED_GRANT_TYPE: 'Sign-in failed — the authentication flow requested is not supported by Companies House. Please contact nodeStream admin.',

      // Companies House own error
      'INVALID AUTHORIZATION' : 'Invalid or expired access token',
      'INVALID_REQUEST': 'The request to Companies House was malformed.',
      'SERVER_ERROR': 'Companies House encountered an unexpected error.', // Could not test this with Companies House system
      'TEMPORARILY_UNAVAILABLE': 'Companies House is temporarily unavailable — please try again shortly.', // Could not test this with Companies House system

      'OFFICER_NOT_RECOGNIZED': 'We couldn\'t confirm you as a registered officer of this company at Companies House. Please check the officers listed for this company and make sure your details match.',
      'MISSING_IDENTITY_NAME': 'Companies House didn\'t share your name with us during sign-in, so we can\'t confirm you as a registered officer. Please try signing in again — if this keeps happening, contact nodeStream support.',
    };

    this.__TURNOVER_CONCEPTS = new Set(['TurnoverRevenue', 'TurnoverGrossOperatingRevenue', 'Revenue']);
    this.__FILING_HISTORY_PAGE_SIZE = 100;
    this.__RETRY_DELAY_MS = 300;
    this.__DOCUMENT_API_HOSTS = new Set([
      'document-api.company-information.service.gov.uk',
    ]);

  }

  /**
   * companiesHouseGetOAuth2URL
   * Note: any scope built against a specific company number causes Companies House's own
   * consent screen to require the company's Authentication Code before the grant completes —
   * a company-level credential only the company or its authorised agents hold. That upstream
   * check is why this flow does not attempt its own officer/identity verification client-side;
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
    let url = `https://identity.company-information.service.gov.uk`;
    if (nodeEnv !== 'PROD') {
      url = `https://identity-sandbox.company-information.service.gov.uk`;
    }

    return `${url}/oauth2/authorise?client_id=${clientId}&redirect_uri=${redirectURI}&scope=${scope}&response_type=code&state=${lambdaInfo.executionId}`;
  }

  /**
   * companiesHouseOAuth2Callback
   * @param {string} nodeEnv
   * @param {Object} companiesHouseKey
   * @param {Object} domainsKey
   * @param {string} companyNumber
   * @param {Object} allowedMembers
   * @param {Object} user
   * @return {Promise}
   */
  async companiesHouseOAuth2Callback(nodeEnv, companiesHouseKey, domainsKey, companyNumber, allowedMembers = [], user = null) {
    try {
      if (!companiesHouseKey) {
        const error = new Error('Missing required secure store data');
        error.code = 400;
        throw error;
      }

      if (lambda.req.query.error) throw new Error(lambda.req.query.error);

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

      let url = `https://identity.company-information.service.gov.uk`;
      if (nodeEnv !== 'PROD') {
        url = `https://identity-sandbox.company-information.service.gov.uk`;
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

      if (!authResult?.body?.access_token || !authResult?.body?.refresh_token) {
        throw new Error('Companies House token exchange did not return usable access/refresh tokens');
      }

      const tokens = {
        accessToken: authResult.body.access_token,
        refreshToken: authResult.body.refresh_token,
      };

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

      if (!companyNumber) {
        const error = new Error('Missing company context for officer verification');
        error.code = 'MISSING_COMPANY_CONTEXT';
        throw error;
      }

      // Officer identity verification is skipped outside PROD: Companies House's sandbox
      // identity service has no way to carry a forename/surname on a test account (confirmed —
      // the sandbox account's own settings only expose password/email, nothing name-related),
      // so this check can never pass in sandbox regardless of which company/officers are set up.
      if (nodeEnv === 'PROD') {
        const identityResult = await this.verifyOfficerIdentity(
          companyNumber,
          {
            forename: profile.forename,
            surname: profile.surname
          },
          nodeEnv,
          companiesHouseKey[Object.keys(companiesHouseKey).find((k) => k.toUpperCase() === 'REST_API_KEY')],
        );
        if (!identityResult.verified) {
          if (identityResult.reason === 'MISSING_IDENTITY_NAME') {
            const error = new Error('MISSING_IDENTITY_NAME');
            error.code = 'MISSING_IDENTITY_NAME';
            throw error;
          }

          const error = new Error('OFFICER_NOT_RECOGNIZED');
          error.code = 'OFFICER_NOT_RECOGNIZED';
          error.data = {
            officersUrl: `https://find-and-update.company-information.service.gov.uk/company/${companyNumber}/officers`,
          };
          throw error;
        }
      }

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
        forename: profile.forename,
        surname: profile.surname,
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
          if (userAuth.forename) updates.push({path: `auth.${authIndex}.forename`, value: userAuth.forename});
          if (userAuth.surname) updates.push({path: `auth.${authIndex}.surname`, value: userAuth.surname});
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
      const errMsg = err.message;
      const errCode = err.code;

      lambda.logError(errMsg);

      let humanReadableError = (typeof errCode === 'string' && this.__OAUTH_CALLBACK_ERROR_MESSAGES[errCode.toUpperCase()]) ? this.__OAUTH_CALLBACK_ERROR_MESSAGES[errCode.toUpperCase()] : null;
      humanReadableError = (humanReadableError) ? humanReadableError : (typeof errMsg === 'string' && this.__OAUTH_CALLBACK_ERROR_MESSAGES[errMsg.toUpperCase()]) ? this.__OAUTH_CALLBACK_ERROR_MESSAGES[errMsg.toUpperCase()] : errMsg;

      err.code = (errCode) ? errCode : errMsg;
      err.message = humanReadableError;
      throw err;
    }
  }

  /**
   * verifyOfficerIdentity
   * Cross-checks a claimed officer's name against a company's live Companies House
   * officer list, confirming the OAuth-authenticated person genuinely holds an
   * active officer role at the company being onboarded.
   * @param {string} companyNumber
   * @param {Object} claimedName - {forename, surname}
   * @param {string} nodeEnv
   * @param {string} restApiKey - Companies House REST API key (Basic auth)
   * @return {Promise<Object>} {verified, matchedOfficer, bypassed}
   */
  async verifyOfficerIdentity(companyNumber, claimedName, nodeEnv, restApiKey) {
    const chBaseUrl = (nodeEnv !== 'PROD')
      ? 'https://api-sandbox.company-information.service.gov.uk'
      : 'https://api.company-information.service.gov.uk';

    const authHeader = `Basic ${Buffer.from(`${restApiKey}:`).toString('base64')}`;
    const res = await fetch({
      url: `${chBaseUrl}/company/${companyNumber}/officers`,
      options: {
        method: 'GET',
        headers: {
          Authorization: authHeader
        }
      },
    });
    if (res.status !== 200) {
      const error = new Error(`Companies House officers lookup failed for company ${companyNumber} (HTTP ${res.status})`);
      error.code = 'OFFICER_LOOKUP_FAILED';
      throw error;
    }

    const officers = res?.body?.items ?? [];
    const claimedSurname = (claimedName.surname || '').trim().toLowerCase();
    const claimedForename = (claimedName.forename || '').trim().toLowerCase();
    if (!claimedSurname || !claimedForename) return { verified: false, matchedOfficer: null, reason: 'MISSING_IDENTITY_NAME' };

    const matchedOfficer = officers.find((officer) => {
      if (officer.resigned_on) return false;
      if (!['director', 'llp-member'].includes(officer.officer_role)) return false;
      const [chSurname, chForenames = ''] = (officer.name || '').split(',').map((s) => s.trim().toLowerCase());
      if (chSurname !== claimedSurname) return false;
      return chForenames.split(/\s+/).filter(Boolean).includes(claimedForename);
    });

    return { verified: !!matchedOfficer, matchedOfficer: matchedOfficer || null };
  }

  /**
   * companiesHouseFetchLatestTurnover
   * @param {Object} credentials
   * @param {string} companyNumber
   * @param {string} restApiKey
   * @return {Promise<Object|null>}
   */
  async companiesHouseFetchLatestTurnover(credentials, companyNumber, restApiKey) {
    const chURL = 'https://api.company-information.service.gov.uk';
    if (!restApiKey) throw new Error('Missing Companies House rest_api_key in secure store');
    const documentAuth = `Basic ${Buffer.from(`${restApiKey}:`).toString('base64')}`;

    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 5);
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    const filings = await this.__collectFilingHistory(chURL, documentAuth, companyNumber, 0, []);

    const candidates = filings
      .map((item) => ({
        item,
        periodEnd: item.description_values?.made_up_date ?? item.action_date ?? item.date,
      }))
      .filter((entry) => entry.periodEnd
        && entry.periodEnd >= cutoffDate
        && entry.item.links?.document_metadata
        && !/dormant/i.test(entry.item.description ?? ''))
      .sort((a, b) => {
        // Primary: most recent period end first.
        if (a.periodEnd !== b.periodEnd) return (a.periodEnd < b.periodEnd) ? 1 : -1;

        // Tiebreak: two filings can legitimately share a periodEnd (a same-period
        // replacement filing, which Companies House explicitly allows). Make the
        // "most recently filed wins" behaviour explicit rather than relying on
        // incidental sort stability plus the collection step's API fetch order.
        const aDate = a.item.date ?? a.item.action_date ?? '';
        const bDate = b.item.date ?? b.item.action_date ?? '';
        if (aDate === bDate) return 0;
        return (aDate < bDate) ? 1 : -1;
      });

    const turnover = await this.__tryNextFiling(documentAuth, candidates, 0);
    if (turnover) return turnover;

    // No candidate yielded a parseable figure — if at least one real, recent, non-dormant
    // accounts filing existed, surface a reference to the most recent one (candidates is
    // sorted most-recent-first) so the customer can be pointed at it even though we
    // couldn't read a number out of it.
    if (candidates.length > 0) {
      return {
        turnover: null,
        transactionId: candidates[0].item.transaction_id,
        filedOn: candidates[0].item.date,
      };
    }

    return null;
  }

  /**
   * __fetchWithRetry
   * Generic retry wrapper used by every fetch call site in the filing-history walk / document
   * fetch chain. Retries once (two attempts total) when the underlying fetch throws, or when
   * it resolves with an HTTP status of 429 or 500-599, waiting a short fixed delay before the
   * retry. Any other status (e.g. a 404 for an invalid company number) is returned immediately
   * on the first attempt with no retry.
   * @param {Object} fetchOptions
   * @return {Promise<Object>}
   */
  async __fetchWithRetry(fetchOptions) {
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let res;
      try {
        res = await lambda.fetch(fetchOptions);
      } catch (err) {
        if (attempt >= maxAttempts) throw err;
        await lambda.sleep(this.__RETRY_DELAY_MS);
        continue;
      }

      const isRetryableStatus = res.status === 429 || (res.status >= 500 && res.status <= 599);
      if (!isRetryableStatus || attempt >= maxAttempts) return res;

      await lambda.sleep(this.__RETRY_DELAY_MS);
    }
  }

  /**
   * __collectFilingHistory
   * @param {string} chURL
   * @param {string} documentAuth
   * @param {string} companyNumber
   * @param {number} startIndex
   * @param {Array<Object>} collected
   * @return {Promise<Array<Object>>}
   */
  async __collectFilingHistory(chURL, documentAuth, companyNumber, startIndex, collected) {
    const filingRes = await this.__fetchWithRetry({
      url: `${chURL}/company/${companyNumber}/filing-history?category=accounts&items_per_page=${this.__FILING_HISTORY_PAGE_SIZE}&start_index=${startIndex}`,
      options: {
        method: 'GET',
        headers: { 'Authorization': documentAuth },
      },
    });

    if (filingRes.status !== 200) throw new Error(`Could not fetch filing history for company: ${companyNumber}`);

    const items = filingRes.body?.items ?? [];
    if (items.length < 1) return collected;

    return this.__collectFilingHistory(chURL, documentAuth, companyNumber, startIndex + this.__FILING_HISTORY_PAGE_SIZE, collected.concat(items));
  }

  /**
   * __tryNextFiling
   * @param {string} documentAuth
   * @param {Array<Object>} candidates
   * @param {number} index
   * @return {Promise<Object|null>}
   */
  async __tryNextFiling(documentAuth, candidates, index) {
    if (index >= candidates.length) return null;

    const turnover = await this.__tryExtractTurnoverFromFiling(documentAuth, candidates[index]);
    if (turnover) return turnover;

    return this.__tryNextFiling(documentAuth, candidates, index + 1);
  }

  /**
   * __isTrustedDocumentHost
   * Parses the given URL and checks its hostname (not a substring/regex match against the raw
   * URL string, which could be spoofed by a hostname that merely contains the expected string)
   * against the known Companies House document API hosts, before we ever let a caller attach
   * the rest_api_key-derived credential to a request against it.
   * @param {string} url
   * @return {boolean}
   */
  __isTrustedDocumentHost(url) {
    const match = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\/([^/?#]+)/.exec(url);
    if (!match) return false;

    let authority = match[1];
    const atIdx = authority.lastIndexOf('@');
    if (atIdx !== -1) authority = authority.slice(atIdx + 1);
    const colonIdx = authority.indexOf(':');
    if (colonIdx !== -1) authority = authority.slice(0, colonIdx);

    return this.__DOCUMENT_API_HOSTS.has(authority.toLowerCase());
  }

  /**
   * __tryExtractTurnoverFromFiling
   * @param {string} documentAuth
   * @param {Object} entry
   * @return {Promise<Object|null>}
   */
  async __tryExtractTurnoverFromFiling(documentAuth, entry) {
    // The document_metadata URL comes straight out of a Companies House API response body.
    // Never attach the documentAuth credential to it without first confirming, via the parsed
    // hostname, that it actually points at a real Companies House document host — a
    // non-matching host is treated exactly like a non-200 response (move on to the next
    // candidate) rather than ever sending the credential to it.
    if (!this.__isTrustedDocumentHost(entry.item.links.document_metadata)) return null;

    const metadataRes = await this.__fetchWithRetry({
      url: entry.item.links.document_metadata,
      options: { method: 'GET', headers: { 'Authorization': documentAuth } },
    });

    if (metadataRes.status !== 200) return null;
    if (!metadataRes.body?.resources?.['application/xhtml+xml']) return null;

    const contentRes = await this.__fetchWithRetry({
      url: `${entry.item.links.document_metadata}/content`,
      options: {
        method: 'GET',
        headers: {
          'Authorization': documentAuth,
          'Accept': 'application/xhtml+xml',
        },
      },
    });

    if (contentRes.status !== 200 || typeof contentRes.body !== 'string') return null;

    const turnover = this.__resolveTurnoverFromIxbrl(contentRes.body, entry.periodEnd);
    if (!turnover) return null;

    return {
      turnover: turnover.value,
      currencyUnit: turnover.unitRef,
      currencyResolved: turnover.currencyResolved,
      resolutionMethod: turnover.resolutionMethod,
      periodEnd: entry.periodEnd,
      filedOn: entry.item.date,
      transactionId: entry.item.transaction_id,
    };
  }

  /**
   * __escapeRegExp
   * Escapes regex metacharacters in a string so it is safe to interpolate into a
   * `new RegExp(...)` pattern. Defence in depth for __getIxbrlAttr — every current call site
   * passes a fixed string literal, but this keeps the function safe if a future call site ever
   * passes a non-literal value.
   * @param {string} str
   * @return {string}
   */
  __escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * __getIxbrlAttr
   * @param {string} openTag
   * @param {string} attrName
   * @return {string|null}
   */
  __getIxbrlAttr(openTag, attrName) {
    const safeAttrName = this.__escapeRegExp(attrName);
    const match = openTag.match(new RegExp(safeAttrName + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i'));
    if (!match) return null;
    return (match[2] !== undefined) ? match[2] : match[3];
  }

  /**
   * __extractIxbrlContexts
   * @param {string} xhtml
   * @return {Map<string, {endDate: string|null, hasDimension: boolean}>}
   */
  __extractIxbrlContexts(xhtml) {
    const contexts = new Map();
    const contextRegex = /<([^:>\s]*:context)\b([^>]*)>([\s\S]*?)<\/\1>/g;
    let match;
    while ((match = contextRegex.exec(xhtml)) !== null) {
      const [, , attrString, body] = match;
      const id = this.__getIxbrlAttr(`<x ${attrString}>`, 'id');
      if (!id) continue;

      const endDateMatch = body.match(/<[^:>\s]*:endDate>\s*([\d-]+)\s*<\/[^:>\s]*:endDate>/);
      const instantMatch = body.match(/<[^:>\s]*:instant>\s*([\d-]+)\s*<\/[^:>\s]*:instant>/);
      const endDate = endDateMatch?.[1] ?? instantMatch?.[1] ?? null;
      const hasDimension = /<[^:>\s]*:(segment|scenario)\b/i.test(body);
      contexts.set(id, { endDate, hasDimension });
    }
    return contexts;
  }

  /**
   * __extractIxbrlNonFractionFacts
   * @param {string} xhtml
   * @return {Array<Object>}
   */
  __extractIxbrlNonFractionFacts(xhtml) {
    const facts = [];
    const factRegex = /<([^:>\s]*:nonFraction)\b([^>]*)>([\s\S]*?)<\/\1>/g;
    let match;
    while ((match = factRegex.exec(xhtml)) !== null) {
      const [, , attrString, rawText] = match;
      const openTag = `<x ${attrString}>`;
      facts.push({
        name: this.__getIxbrlAttr(openTag, 'name'),
        contextRef: this.__getIxbrlAttr(openTag, 'contextRef'),
        unitRef: this.__getIxbrlAttr(openTag, 'unitRef'),
        sign: this.__getIxbrlAttr(openTag, 'sign'),
        scale: this.__getIxbrlAttr(openTag, 'scale'),
        rawText: rawText.replace(/<[^>]+>/g, '').trim(),
      });
    }
    return facts;
  }

  /**
   * __extractIxbrlUnits
   * Finds every unit definition element in the document (local tag name "unit", ignoring
   * namespace prefix, with an "id" attribute) and resolves the currency code from its nested
   * measure element. The measure text is typically of the form "prefix:CODE" (e.g.
   * "iso4217:GBP") — if a colon is present the part after the last colon is used, otherwise the
   * whole trimmed text is used as-is. Returns a map from unit id to resolved currency code.
   * @param {string} xhtml
   * @return {Map<string, string>}
   */
  __extractIxbrlUnits(xhtml) {
    const units = new Map();
    const unitRegex = /<([^:>\s]*:unit)\b([^>]*)>([\s\S]*?)<\/\1>/g;
    let match;
    while ((match = unitRegex.exec(xhtml)) !== null) {
      const [, , attrString, body] = match;
      const id = this.__getIxbrlAttr(`<x ${attrString}>`, 'id');
      if (!id) continue;

      const measureMatch = body.match(/<([^:>\s]*:measure)>\s*([^<]*?)\s*<\/\1>/);
      if (!measureMatch) continue;

      const rawMeasure = measureMatch[2].trim();
      if (!rawMeasure) continue;

      const lastColonIdx = rawMeasure.lastIndexOf(':');
      const currencyCode = (lastColonIdx !== -1) ? rawMeasure.slice(lastColonIdx + 1) : rawMeasure;
      if (currencyCode) units.set(id, currencyCode);
    }
    return units;
  }

  /**
   * __resolveTurnoverFromIxbrl
   * @param {string} xhtml
   * @param {string} periodEndDate
   * @return {Object|null}
   */
  __resolveTurnoverFromIxbrl(xhtml, periodEndDate) {
    const contexts = this.__extractIxbrlContexts(xhtml);
    const facts = this.__extractIxbrlNonFractionFacts(xhtml);
    const units = this.__extractIxbrlUnits(xhtml);

    const candidates = facts.filter((fact) => {
      if (!fact.name || !fact.contextRef) return false;
      if (!this.__TURNOVER_CONCEPTS.has(fact.name.split(':').pop())) return false;
      const context = contexts.get(fact.contextRef);
      return !!context && !context.hasDimension && context.endDate === periodEndDate;
    });

    if (candidates.length < 1) return null;

    const values = candidates
      .map((fact) => {
        let value = parseFloat(fact.rawText.replace(/,/g, ''));
        if (Number.isNaN(value)) return null;
        const scale = parseInt(fact.scale, 10);
        if (!Number.isNaN(scale)) value *= Math.pow(10, scale);
        if (fact.sign === '-') value *= -1;
        return { value, unitRef: fact.unitRef };
      })
      .filter(Boolean);

    if (values.length < 1) return null;
    if (new Set(values.map((v) => v.value)).size > 1) return null;

    const winner = values[0];

    // A negative turnover is a technically-valid parse (sign="-") but a nonsensical figure to
    // use downstream for pricing — treat it the same as "nothing usable found" rather than
    // returning it, and never silently flip its sign.
    if (winner.value < 0) return null;

    // Resolve the winning fact's unitRef (a document-local id like "U1") against the
    // document's own unit definitions rather than trusting it as a currency code directly —
    // nothing guarantees a filer named their unit id after an ISO 4217 code, even though many
    // happen to by convention. Fall back to the raw unitRef if it can't be resolved, but flag
    // that so a downstream consumer can tell a genuinely-resolved ISO code apart from an
    // unresolved raw id string.
    const resolvedCurrency = units.get(winner.unitRef);
    return {
      value: winner.value,
      unitRef: resolvedCurrency ?? winner.unitRef,
      currencyResolved: !!resolvedCurrency,
      resolutionMethod: 'CONCEPT_NAME_MATCH',
    };
  }
}

module.exports = new CompaniesHouseAuth();
