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
   * retrieveCustomer
   * @param {object} stripeKeys
   * @param {string} customerId
   * @param {string} searchQuery
   */
  async retrieveCustomer(stripeKeys, customerId, searchQuery) {
    if (customerId) {
      const getCustomerReq = await lambda.fetch({
        url: `https://api.stripe.com/v1/customers/${customerId}`,
        options: {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${stripeKeys['secret_key']}`,
            'Content-Type': 'application/json',
          },
        },
      });
      if (!getCustomerReq.status || getCustomerReq.status !== 200) throw new Error(getCustomerReq);
      const stripeCustomer = getCustomerReq.body;
      if (stripeCustomer.deleted) {
        throw new Error(`Found a deleted Stripe customer linked to the details that were provided`);
      }

      return stripeCustomer;
    }

    if (!customerId && searchQuery) {
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
      return searchReq.body;
    }
  }

  /**
   * createOrFindCustomer
   * @param {Object} stripeKeys
   * @param {Object} customer
   * @param {string} personId
   * @param {string} stripeCustomerId
   * @return {Promise}
   */
  async createOrFindCustomer(stripeKeys, customer, personId, stripeCustomerId) {
    try {
      const searchQuery = `name: '${customer.firstName} ${customer.lastName}' AND email: '${customer.emailAddress}' AND phone: '${customer.mobileNumber}' AND metadata['personId']: '${personId}'`;
      let customerRes = null;
      let stripeCustomer = null;

      if (!customer.firstName || !customer.lastName || !customer.mobileNumber|| !customer.emailAddress
          || !customer.address.address1 || !customer.address.postcode || !customer.address.city || !customer.address.country) {
        throw new Error('The customer information is missing a required field');
      }

      if (stripeCustomerId) {
        stripeCustomer = await this.retrieveCustomer(stripeKeys, stripeCustomerId);
      } else {
        customerRes = await this.retrieveCustomer(stripeKeys, null, searchQuery)
      }

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
        throw new Error(`Stripe returned more than one customer with the search query: ${searchQuery}`);
      }

      return stripeCustomer;
    } catch (err) {
      const message = (typeof err === 'string') ? err : err.message;

      throw new Error(message);
    }
  }

  /**
   * searchSubscription
   * @param {Object} stripeKeys
   * @param {string} customerId
   * @param {string} priceId
   * @param {string} companyId
   */
  async searchSubscription(stripeKeys, customerId, priceId, companyId) {
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

    return searchReq.body;
  }

  /**
   * createCustomerSubscription
   * @param {Object} stripeKeys
   * @param {string} priceId
   * @param {string} customerId
   * @param {string} companyId
   * @param {number} trialEnd
   * @return {Promise}
   */
  async createCustomerSubscription(stripeKeys, priceId, customerId, companyId, trialEnd = null) {
    try {
      let subscription = null;
      // Check if a customer is already subscribed
      const subscriptionRes = await this.searchSubscription(stripeKeys, customerId, priceId, companyId);
      let subscriptions = subscriptionRes?.data;
      subscriptions = subscriptions.filter((s) => s.status !== 'incomplete_expired' && s.status !== 'canceled');
      const activeSubscription = subscriptions.find((s) => s.status === 'active' || s.status === 'trialing' || s.status === 'unpaid' || s.status === 'paused');
      if (activeSubscription) {
        throw new Error(`The customer is already subscribed to a plan`);
      }

      if (subscriptions.some((s) => s.status === 'past_due')) {
        throw new Error(`Found a past due subscription for customer ${customerId}, please contact our support to resolve that`);
      }

      const incompleteSubscription = subscriptions.find((s) => s.status === 'incomplete');
      if (incompleteSubscription) {
        console.log(`Found an incomplete subscribtion for customer ${customerId}`);
        subscription = incompleteSubscription;
      }

      if (subscriptions.length < 1) {
        // Subscribe the customer to a plan
        const body = {
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
        };
        if (trialEnd) {
          body['billing_cycle_anchor'] = ~~trialEnd,
          body['trial_end'] = ~~trialEnd;
        }

        const options = {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${stripeKeys['secret_key']}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body,
        };

        const result = await lambda.fetch({
          url: `https://api.stripe.com/v1/subscriptions`,
          options,
        });
        if (!result.status || result.status !== 200) throw new Error(result);

        subscription = result.body;
      }

      if (!subscription) {
        throw new Error(`Can not find subscription`);
      }

      return subscription;
    } catch (err) {
      const message = (typeof err === 'string') ? err : err.message;

      throw new Error(message);
    }
  }

  /**
   * getPaymentMethod
   * @param {Object} stripeKeys
   * @param {strong} paymentMethodId
   * @returns 
   */
  async getPaymentMethod(stripeKeys, paymentMethodId) {
    try {
      const req = await lambda.fetch({
        url: `https://api.stripe.com/v1/payment_methods/${paymentMethodId}`,
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
      const message = (typeof err === 'string') ? err : err.message;

      throw new Error(message);
    }
  }

  /**
   * createPaymentIntent
   * @param {Object} stripeKeys
   * @param {number} amount
   * @param {string} companyId
   * @param {string} userId
   */
  async createPaymentIntent(stripeKeys, amount, companyId, userId) {
    try {
      // Create a new payment intent
      console.log('Create a new payment intent');
      const options = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${stripeKeys['secret_key']}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: {
          'amount': amount,
          'currency': 'GBP',
          'payment_method_types': ['card'],
          'automatic_payment_methods[enabled]': true,
          'metadata[companyId]': companyId,
          'metadata[userId]': userId,
        },
      };

      const result = await lambda.fetch({
        url: `https://api.stripe.com/v1/payment_intents`,
        options,
      });
      if (!result.status || result.status !== 200) throw new Error(result);

      return result.body;
    } catch (err) {
      const message = (typeof err === 'string') ? err : err.message;

      throw new Error(message);
    }
  }

  /**
   * createPaymentIntent
   * @param {Object} stripeKeys
   * @param {string} paymentIntentId
   * @param {Object} updates
   */
  async updatePaymentIntent(stripeKeys, paymentIntentId, updates) {
    try {
      // Update an existing payment intent
      console.log('Update an existing payment intent');
      const options = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${stripeKeys['secret_key']}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: updates,
      };

      const result = await lambda.fetch({
        url: `https://api.stripe.com/v1/payment_intents/${paymentIntentId}`,
        options,
      });
      if (!result.status || result.status !== 200) throw new Error(result);

      return result.body;
    } catch (err) {
      const message = (typeof err === 'string') ? err : err.message;

      throw new Error(message);
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
        url: `https://api.stripe.com/v1/payment_intents/${paymentId}?expand[0]=customer&expand[1]=payment_method`,
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
      const message = (typeof err === 'string') ? err : err.message;

      throw new Error(message);
    }
  }

  /**
   * getPaymentSetupIntent
   * @param {Object} stripeKeys
   * @param {string} paymentSetupId
   * @return {Promise}
   */
  async getPaymentSetupIntent(stripeKeys, paymentSetupId) {
    try {
      const req = await lambda.fetch({
        url: `https://api.stripe.com/v1/setup_intents/${paymentSetupId}`,
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
      const message = (typeof err === 'string') ? err : err.message;

      throw new Error(message);
    }
  }

  /**
   * getInvoice
   * @param {Object} stripeKeys
   * @param {string} invoiceId
   * @return {Promise}
   */
  async getInvoice(stripeKeys, invoiceId) {
    try {
      const req = await lambda.fetch({
        url: `https://api.stripe.com/v1/invoices/${invoiceId}`,
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
      const message = (typeof err === 'string') ? err : err.message;

      throw new Error(message);
    }
  }

  /**
   * cancelSubscription
   * @param {Object} stripeKeys
   * @param {string} subscriptionId
   * @param {string} cancellationReason
   * @return {Promise}
   */
  async cancelSubscription(stripeKeys, subscriptionId, cancellationReason) {
    try {
      const req = await lambda.fetch({
        url: `https://api.stripe.com/v1/subscriptions/${subscriptionId}`,
        options: {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${stripeKeys['secret_key']}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: {
            'cancel_at_period_end': true,
            'cancellation_details[comment]': cancellationReason,
          },
        },
      });

      if (!req.status || req.status !== 200) throw new Error(req);
      return req.body;
    } catch (err) {
      const message = (typeof err === 'string') ? err : err.message;

      throw new Error(message);
    }
  }

  /**
   * reactivateSubscription
   * @param {Object} stripeKeys
   * @param {string} subscriptionId
   * @return {Promise}
   */
  async reactivateSubscription(stripeKeys, subscriptionId) {
    try {
      const req = await lambda.fetch({
        url: `https://api.stripe.com/v1/subscriptions/${subscriptionId}`,
        options: {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${stripeKeys['secret_key']}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: {
            'cancel_at_period_end': false,
          },
        },
      });

      if (!req.status || req.status !== 200) throw new Error(req);
      return req.body;
    } catch (err) {
      const message = (typeof err === 'string') ? err : err.message;

      throw new Error(message);
    }
  }

  /**
   * attachPaymentToCustomer
   * @param {string} stripeKeys
   * @param {string} paymentMethodId
   * @param {string} customerId
   * @return {Promise}
   */
  async attachPaymentMethodToCustomer(stripeKeys, paymentMethodId, customerId) {
    try {
      const req = await lambda.fetch({
        url: `https://api.stripe.com/v1/payment_methods/${paymentMethodId}/attach`,
        options: {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${stripeKeys['secret_key']}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: {
            customer: customerId,
          },
        },
      });
      if (!req.status || req.status !== 200) throw new Error(req);

      return req.body;
    } catch (err) {
      const message = (typeof err === 'string') ? err : err.message;

      throw new Error(message);
    }
  }

  /**
   * updateSubscriptionCardDetails
   * @param {Object} stripeKeys
   * @param {string} subscriptionId
   * @param {string} paymentMethodId
   * @return {Promise}
   */
  async updateSubscriptionCardDetails(stripeKeys, subscriptionId, paymentMethodId) {
    try {
      const req = await lambda.fetch({
        url: `https://api.stripe.com/v1/subscriptions/${subscriptionId}`,
        options: {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${stripeKeys['secret_key']}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: {
            'default_payment_method': paymentMethodId,
          },
        },
      });
      if (!req.status || req.status !== 200) throw new Error(req);

      return req.body;
    } catch (err) {
      const message = (typeof err === 'string') ? err : err.message;

      throw new Error(message);
    }
  }

  /**
   * updateSubscriptionPlan
   * @param {Object} stripeKeys
   * @param {Object} subscriptionDB
   * @param {string} productId
   * @param {string} command
   * @return {Promise}
   */
  async updateSubscriptionPlan(stripeKeys, subscriptionDB, productId, command) {
    try {
      let subscription = null;
      await this.cancelSubscription(stripeKeys, subscriptionDB.billing.subscriptionId, command);
      const subscriptionRes = await this.searchSubscription(stripeKeys, subscriptionDB.billing.customerId, productId, subscriptionDB.companyId);
      const subscriptions = subscriptionRes?.data;
      subscription = subscriptions.find((s) => s.status === 'active' || s.status === 'trialing');
      if (!subscription) {
        const trialEnd = Sugar.Date.create(subscriptionDB.renewalDate).getTime()/1000;
        subscription = await this.createCustomerSubscription(stripeKeys, productId, subscriptionDB.billing.customerId, subscriptionDB.companyId, trialEnd);
      }

      return subscription;
    } catch (err) {
      const message = (typeof err === 'string') ? err : err.message;

      throw new Error(message);
    }
  }
}
module.exports = new Stripe();