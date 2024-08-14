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

/**
 * @class Stripe
 */
class Stripe {
  /**
   * Creates an instance of Stripe
   */
  constructor() {
    this.name = 'STRIPE';
  }

  /**
   * createCustomer
   * @param {Object} stripeKeys
   * @param {Object} customer
   * @param {string} personId
   * @param {string} stripeCustomerId
   * @return {Promise}
   */
  async createCustomer(stripeKeys, customer, personId, stripeCustomerId) {
    try {
      const searchQuery = `name: '${customer.firstName} ${customer.lastName}' AND email: '${customer.emailAddress}' AND phone: '${customer.mobileNumber}' AND metadata['personId']: '${personId}'`;
      let customerRes = null;
      let stripeCustomer = null;

      if (!customer.firstName || !customer.lastName || !customer.mobileNumber|| !customer.emailAddress
          || !customer.address.address1 || !customer.address.postcode || !customer.address.city || !customer.address.country) {
        throw new Error('The customer information is missing a required field');
      }

      if (stripeCustomerId) {
        const getCustomerReq = await lambda.fetch({
          url: `https://api.stripe.com/v1/customers/${stripeCustomerId}`,
          options: {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${stripeKeys['secret_key']}`,
              'Content-Type': 'application/json',
            },
          },
        });
        if (!getCustomerReq.status || getCustomerReq.status !== 200) throw new Error(getCustomerReq);
        stripeCustomer = getCustomerReq.body;
        if (stripeCustomer.deleted) {
          throw new Error(`Found a deleted Stripe customer linked to the details that were provided`);
        }
      } else {
        // Search if a customer already exists
        const searchReq = await lambda.fetch({
          url: `https://api.stripe.com/v1/customers/search?query=${searchQuery}`,
          options: {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${stripeKeys['secret_key']}`,
              'Content-Type': 'application/json',
            },
          },
        });
        if (!searchReq.status || searchReq.status !== 200) throw new Error(searchReq);
        customerRes = searchReq.body;
      }

      console.log(`customerRes: ${JSON.stringify(customerRes)}`);
      console.log(`stripeCustomer: ${JSON.stringify(stripeCustomer)}`);
      if (customerRes && customerRes.data.length < 1 && !stripeCustomer) {
        // Create a new customer
        console.log('Create a new customer');
        const options = {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${stripeKeys['secret_key']}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: {
            'name': `${customer.firstName} ${customer.lastName}`,
            'phone': customer.mobileNumber,
            'email': customer.emailAddress,
            'address[line1]': customer.address.address1,
            'address[line2]': customer.address.address2,
            'address[postal_code]': customer.address.postcode,
            'address[city]': customer.address.city,
            'address[country]': customer.address.country,
            'metadata[personId]': personId,
          },
        };

        const result = await lambda.fetch({
          url: `https://api.stripe.com/v1/customers`,
          options,
        });
        if (!result.status || result.status !== 200) throw new Error(result);

        stripeCustomer = result.body;
      } else if(customerRes && customerRes.data.length === 1) {
        [stripeCustomer] = customerRes.data;
      } else if (customerRes && customerRes.data.length > 1) {
        lambda.logError(`Stripe returned more than one customer with the search query: ${searchQuery}`);
        throw new Error(`Stripe returned more than one customer with the search query: ${searchQuery}`);
      }

      return stripeCustomer;
    } catch (err) {
      if (typeof err === 'string') {
        throw new Error(err);
      }

      throw new Error(err.message);
    }
  }

  /**
   * createCustomerSubscription
   * @param {Object} stripeKeys
   * @param {string} priceId
   * @param {string} customerId
   * @param {string} companyId
   * @return {Promise}
   */
  async createCustomerSubscription(stripeKeys, priceId, customerId, companyId) {
    try {
      let subscription = null;
      // Check if a customer is already subscribed
      const searchQuery = `metadata['planId']: '${priceId}' AND metadata['customerId']: '${customerId}' AND metadata['companyId']: '${companyId}'`;
      const searchReq = await lambda.fetch({
        url: `https://api.stripe.com/v1/subscriptions/search?query=${searchQuery}&expand[0]=data.latest_invoice.payment_intent`,
        options: {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${stripeKeys['secret_key']}`,
            'Content-Type': 'application/json',
          },
        },
      });
      if (!searchReq.status || searchReq.status !== 200) throw new Error(searchReq);

      const subscriptionRes = searchReq.body;
      const activeSubscription = subscriptionRes.data.find((s) => s.status === 'active');
      if (activeSubscription) {
        lambda.logError(`The customer is already subscribed to a plan`);
        throw new Error(`The customer is already subscribed to a plan`);
      }

      const incompleteSubscription = subscriptionRes.data.find((s) => s.status === 'incomplete');
      if (incompleteSubscription) {
        lambda.log(`Found an incomplete subscribtion for customer ${customerId}`);
        subscription = incompleteSubscription;
      }

      if (subscriptionRes.data.length < 1) {
        // Subscribe the customer to a plan
        const options = {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${stripeKeys['secret_key']}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: {
            'customer': customerId,
            'currency': 'GBP',
            'payment_behavior': 'default_incomplete',
            'payment_settings[save_default_payment_method]': 'on_subscription',
            'payment_settings[payment_method_types][]': ['card'],
            'items[][price]': priceId,
            'metadata[planId]': priceId,
            'metadata[customerId]': customerId,
            'metadata[companyId]': companyId,
            'expand[0]': 'latest_invoice.payment_intent',
          },
        };

        const result = await lambda.fetch({
          url: `https://api.stripe.com/v1/subscriptions`,
          options,
        });
        if (!result.status || result.status !== 200) throw new Error(result);

        subscription = result.body;
      }

      if (!subscription) {
        lambda.logError(`Can not find subscription`);
        throw new Error(`Can not find subscription`);
      }

      return subscription;
    } catch (err) {
      if (typeof err === 'string') {
        lambda.logError(err);
        throw new Error(err);
      }

      lambda.logError(err.message);
      throw new Error(err.message);
    }
  }

  /**
   * getPaymentIntent
   * @param {Object} stripeKeys
   * @param {string} paymentId
   * @return {Promise}
   */
  async getPaymentIntent(stripeKeys, paymentId) {
    try {
      const req = await lambda.fetch({
        url: `https://api.stripe.com/v1/payment_intents/${paymentId}?expand[0]=customer`,
        options: {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${stripeKeys['secret_key']}`,
            'Content-Type': 'application/json',
          },
        },
      });
      if (!req.status || req.status !== 200) throw new Error(req);

      return req.body;
    } catch (err) {
      if (typeof err === 'string') {
        lambda.logError(err);
        throw new Error(err);
      }

      lambda.logError(err.message);
      throw new Error(err.message);
    }
  }
}
module.exports = new Stripe();