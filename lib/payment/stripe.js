'use strict';

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
   * Retrieve a payment intent
   * @param {Object} stripeKeys
   * @param {string} paymentId
   */
  async getPaymentIntent(stripeKeys, paymentId) {
    try {
      const options = {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${stripeKeys['secret_key']}`,
        },
      };
      const req = await lambda.fetch({
        url: `https://api.stripe.com/v1/payment_intent/${paymentId}`,
        options,
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

  /**
   * createCustomer
   * @param {Object} stripeKeys
   * @param {Object} customer
   * @return {Promise}
   */
  async createCustomer(stripeKeys, customer) {
    try {
      let stripeCustomer = null;

      // Check if a customer already exists
      const searchQuery = `name: '${customer.firstName} ${customer.lastName}' AND email: '${customer.emailAddress}' AND phone: '${customer.mobileNumber}'`;
      const searchReq = await lambda.fetch(`https://api.stripe.com/v1/customers/search?query=${searchQuery}`);
      if (!searchReq.status || searchReq.status !== 200) throw new Error(searchReq);

      const customerRes = searchReq.body;
      if (customerRes.data.lenngth < 1) {
        // Create a new customer
        const options = {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${stripeKeys['secret_key']}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: {
            name: `${customer.firstName} ${customer.lastName}`,
            phone: customer.mobileNumber,
            email: customer.emailAddress,
            address: {
              line1: customer.address.address1,
              line2: customer.address.address2,
              postal_code: customer.address.postcode,
              city: customer.address.city,
              country: customer.address.country,
            },
          },
        };
  
        const result = await lambda.fetch({
          url: `https://api.stripe.com/v1/customers`,
          options,
        });
        if (!result.status || result.status !== 200) throw new Error(result);

        stripeCustomer = result.body;
      } else if(customerRes.data.lenngth === 1) {
        [stripeCustomer] = customerRes.data;
      } else {
        lambda.logError(`Stripe returned more than one customer with the search query: ${searchQuery}`);
        throw new Error(`Stripe returned more than one customer with the search query: ${searchQuery}`);
      }

      return stripeCustomer;
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
   * createCustomerSubscription
   * @param {Object} stripeKeys
   * @param {String} priceId
   * @param {String} customerId
   * @return {Promise}
   */
  async createCustomerSubscription(stripeKeys, priceId, customerId) {
    try {
      // Check if a customer is already subscribed
      const searchQuery = `customer: '${customerId}' AND items['data']['plan']['id']: '${priceId}'`;
      const searchReq = await lambda.fetch(`https://api.stripe.com/v1/subscriptions/search?query=${searchQuery}`);
      if (!searchReq.status || searchReq.status !== 200) throw new Error(searchReq);

      const subscriptionRes = searchReq.body;
      if (subscriptionRes.data.lenngth < 1) {
        // Subscribe the customer to a plan
        const options = {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${stripeKeys['secret_key']}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: {
            customer: customerId,
            currency: 'GBP',
            payment_behavior: 'default_incomplete',
            payment_settings: {
              save_default_payment_method: 'on_subscription',
              payment_method_types: ['card'],
            },
            expand: ['latest_invoice.payment_intent'],
            items: [{
              price: priceId,
            }]
          },
        };

        const result = await lambda.fetch({
          url: `https://api.stripe.com/v1/subscriptions`,
          options,
        });
        if (!result.status || result.status !== 200) throw new Error(result);

        const subscription = result.body;
        return {
          subscriptionId: subscription.id,
          clientSecret: subscription.latest_invoice.payment_intent.clientSecret,
        };
      } else {
        lambda.logError(`The customer is already subscribed to a plan`);
        throw new Error(`The customer is already subscribed to a plan`);
      }
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