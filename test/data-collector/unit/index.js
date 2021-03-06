'use strict';

var basicComponentVerification = require('../../../src/lib/basic-component-verification');
var dataCollector = require('../../../src/data-collector');
var createDeferredClient = require('../../../src/lib/create-deferred-client');
var createAssetsUrl = require('../../../src/lib/create-assets-url');
var kount = require('../../../src/data-collector/kount');
var fraudnet = require('../../../src/data-collector/fraudnet');
var BraintreeError = require('../../../src/lib/braintree-error');
var rejectIfResolves = require('../../helpers/promise-helper').rejectIfResolves;
var methods = require('../../../src/lib/methods');
var fake = require('../../helpers/fake');

describe('dataCollector', function () {
  beforeEach(function () {
    this.configuration = fake.configuration();
    this.configuration.gatewayConfiguration.kount = {kountMerchantId: '12345'};
    this.client = fake.client({
      configuration: this.configuration
    });
    this.sandbox.stub(kount, 'setup');
    this.sandbox.stub(fraudnet, 'setup');
    this.sandbox.stub(createDeferredClient, 'create').resolves(this.client);
    this.sandbox.stub(createAssetsUrl, 'create').returns('https://example.com/assets');
    this.sandbox.stub(basicComponentVerification, 'verify').resolves();
  });

  describe('create', function () {
    it('supports a callback', function (done) {
      var self = this;
      var mockData = {
        deviceData: {
          device_session_id: 'did', // eslint-disable-line camelcase
          fraud_merchant_id: '12345' // eslint-disable-line camelcase
        }
      };

      kount.setup.returns(mockData);

      dataCollector.create({
        client: this.client,
        kount: true
      }, function () {
        expect(kount.setup).to.be.calledWith(self.sandbox.match({
          merchantId: '12345'
        }));

        done();
      });
    });

    it('verifies with basicComponentVerification', function (done) {
      var client = this.client;

      dataCollector.create({
        client: client
      }, function () {
        expect(basicComponentVerification.verify).to.be.calledOnce;
        expect(basicComponentVerification.verify).to.be.calledWithMatch({
          name: 'Data Collector',
          client: client
        });
        done();
      });
    });

    it('can create with an authorization instead of a client', function (done) {
      var mockData = {
        deviceData: {
          device_session_id: 'did', // eslint-disable-line camelcase
          fraud_merchant_id: '12345' // eslint-disable-line camelcase
        }
      };

      kount.setup.returns(mockData);

      dataCollector.create({
        kount: true,
        authorization: fake.clientToken,
        debug: true
      }, function (err, dtInstance) {
        expect(err).not.to.exist;
        expect(dtInstance).to.exist;

        expect(createDeferredClient.create).to.be.calledOnce;
        expect(createDeferredClient.create).to.be.calledWith({
          authorization: fake.clientToken,
          client: this.sandbox.match.typeOf('undefined'),
          debug: true,
          assetsUrl: 'https://example.com/assets',
          name: 'Data Collector'
        });

        done();
      }.bind(this));
    });

    it('returns an error if merchant is not enabled for kount but specified kount', function () {
      delete this.configuration.gatewayConfiguration.kount;

      return dataCollector.create({client: this.client, kount: true}).then(rejectIfResolves).catch(function (err) {
        expect(err).to.be.an.instanceof(BraintreeError);
        expect(err.message).to.equal('Kount is not enabled for this merchant.');
        expect(err.code).to.equal('DATA_COLLECTOR_KOUNT_NOT_ENABLED');
        expect(err.type).to.equal('MERCHANT');
      });
    });

    it('returns an error if kount and paypal are not defined', function () {
      return dataCollector.create({client: this.client}).then(rejectIfResolves).catch(function (err) {
        expect(err).to.be.an.instanceof(BraintreeError);
        expect(err.message).to.equal('Data Collector must be created with Kount and/or PayPal.');
        expect(err.code).to.equal('DATA_COLLECTOR_REQUIRES_CREATE_OPTIONS');
        expect(err.type).to.equal('MERCHANT');
      });
    });

    it('returns an error if kount throws an error', function () {
      kount.setup.throws(new Error('foo boo'));

      return dataCollector.create({
        client: this.client,
        kount: true
      }).then(rejectIfResolves).catch(function (err) {
        expect(err).to.be.an.instanceof(BraintreeError);
        expect(err.message).to.equal('foo boo');
        expect(err.type).to.equal('MERCHANT');
        expect(err.code).to.equal('DATA_COLLECTOR_KOUNT_ERROR');
      });
    });

    it('sets Kount merchantId from gateway configuration', function () {
      var self = this;
      var mockData = {
        deviceData: {
          device_session_id: 'did', // eslint-disable-line camelcase
          fraud_merchant_id: '12345' // eslint-disable-line camelcase
        }
      };

      kount.setup.returns(mockData);

      return dataCollector.create({
        client: this.client,
        kount: true
      }).then(function () {
        expect(kount.setup).to.be.calledWith(self.sandbox.match({
          merchantId: '12345'
        }));
      });
    });

    it('returns only kount information if kount is true but paypal is false', function () {
      var mockData = {
        deviceData: {
          device_session_id: 'did', // eslint-disable-line camelcase
          fraud_merchant_id: 'fmid' // eslint-disable-line camelcase
        }
      };

      kount.setup.returns(mockData);

      return dataCollector.create({
        client: this.client,
        kount: true
      }).then(function (actual) {
        expect(actual.deviceData).to.equal(JSON.stringify(mockData.deviceData));
      });
    });

    it('returns only fraudnet information if kount is false but paypal is true', function () {
      var mockData = {
        sessionId: 'thingy'
      };

      fraudnet.setup.resolves(mockData);

      return dataCollector.create({
        client: this.client,
        paypal: true
      }).then(function (actual) {
        expect(actual.deviceData).to.equal('{"correlation_id":"' + mockData.sessionId + '"}');
      });
    });

    it('returns both fraudnet information if kount and paypal are present', function () {
      var mockPPid = 'paypal_id';
      var mockData = {
        deviceData: {
          device_session_id: 'did', // eslint-disable-line camelcase
          fraud_merchant_id: 'fmid' // eslint-disable-line camelcase
        }
      };

      kount.setup.returns(mockData);
      fraudnet.setup.resolves({
        sessionId: mockPPid
      });

      return dataCollector.create({
        client: this.client,
        paypal: true,
        kount: true
      }).then(function (data) {
        var actual;

        actual = JSON.parse(data.deviceData);
        expect(actual.correlation_id).to.equal(mockPPid);
        expect(actual.device_session_id).to.equal(mockData.deviceData.device_session_id);
        expect(actual.fraud_merchant_id).to.equal(mockData.deviceData.fraud_merchant_id);
      });
    });

    it('returns different data every invocation', function () {
      var actual1;
      var mockPPid = 'paypal_id';
      var mockData = {
        deviceData: {
          device_session_id: 'did', // eslint-disable-line camelcase
          fraud_merchant_id: 'fmid' // eslint-disable-line camelcase
        }
      };

      kount.setup.returns(mockData);
      fraudnet.setup.resolves({
        sessionId: mockPPid
      });

      return dataCollector.create({
        client: this.client,
        paypal: true,
        kount: true
      }).then(function (actual) {
        actual1 = actual;
        kount.setup.returns({deviceData: {newStuff: 'anything'}});
        fraudnet.setup.resolves({
          sessionId: 'newid'
        });

        return dataCollector.create({
          client: this.client,
          paypal: true,
          kount: true
        }).then(function (actual2) {
          expect(actual1.deviceData).not.to.equal(actual2.deviceData);
        });
      }.bind(this));
    });

    it('provides rawDeviceData', function () {
      var mockPPid = 'paypal_id';
      var mockData = {
        deviceData: {
          device_session_id: 'did', // eslint-disable-line camelcase
          fraud_merchant_id: 'fmid' // eslint-disable-line camelcase
        }
      };

      kount.setup.returns(mockData);
      fraudnet.setup.resolves({
        sessionId: mockPPid
      });

      return dataCollector.create({
        client: this.client,
        paypal: true,
        kount: true
      }).then(function (instance) {
        expect(instance.rawDeviceData).to.deep.equal({
          correlation_id: 'paypal_id', // eslint-disable-line camelcase
          device_session_id: 'did', // eslint-disable-line camelcase
          fraud_merchant_id: 'fmid' // eslint-disable-line camelcase
        });
      });
    });

    it('does not add correlation id if fraudnet.setup resolves without an instance', function () {
      var mockData = {
        deviceData: {
          device_session_id: 'did', // eslint-disable-line camelcase
          fraud_merchant_id: 'fmid' // eslint-disable-line camelcase
        }
      };

      kount.setup.returns(mockData);
      fraudnet.setup.resolves(null);

      return dataCollector.create({
        client: this.client,
        kount: true,
        paypal: true
      }).then(function (actual) {
        expect(actual.deviceData).to.equal(JSON.stringify(mockData.deviceData));
      });
    });
  });

  describe('teardown', function () {
    it('runs teardown on all instances', function (done) {
      var kountTeardown = this.sandbox.spy();
      var fraudnetTeardown = this.sandbox.spy();

      kount.setup.returns({
        deviceData: {},
        teardown: kountTeardown
      });
      fraudnet.setup.resolves({
        sessionId: 'anything',
        teardown: fraudnetTeardown
      });

      dataCollector.create({
        client: this.client,
        paypal: true,
        kount: true
      }, function (err, actual) {
        expect(err).not.to.exist;

        actual.teardown();

        expect(fraudnetTeardown).to.be.called;
        expect(kountTeardown).to.be.called;

        done();
      });
    });

    it('calls provided callback on teardown', function (done) {
      kount.setup.returns({
        deviceData: {},
        teardown: function () {}
      });
      fraudnet.setup.resolves({
        sessionId: 'anything',
        teardown: function () {}
      });

      dataCollector.create({
        client: this.client,
        paypal: true,
        kount: true
      }, function (err, actual) {
        actual.teardown(function () {
          done();
        });
      });
    });

    it('returns a promise if no callback is provided', function (done) {
      kount.setup.returns({
        deviceData: {},
        teardown: function () {}
      });
      fraudnet.setup.resolves({
        sessionId: 'anything',
        teardown: function () {}
      });

      dataCollector.create({
        client: this.client,
        paypal: true,
        kount: true
      }, function (err, actual) {
        actual.teardown().then(function () {
          done();
        });
      });
    });

    it('replaces all methods so error is thrown when methods are invoked', function (done) {
      kount.setup.returns({
        deviceData: {},
        teardown: function () {}
      });
      fraudnet.setup.resolves({
        sessionId: 'anything',
        teardown: function () {}
      });

      dataCollector.create({
        client: this.client,
        paypal: true,
        kount: true
      }, function (err, data) {
        data.teardown(function () {
          var tornDownMethods = methods(data);

          expect(tornDownMethods.length).to.be.greaterThan(0);

          tornDownMethods.forEach(function (method) {
            var error;

            try {
              data[method]();
            } catch (e) {
              error = e;
            }

            expect(error).to.be.an.instanceof(BraintreeError);
            expect(error.type).to.equal('MERCHANT');
            expect(error.code).to.equal('METHOD_CALLED_AFTER_TEARDOWN');
            expect(error.message).to.equal(method + ' cannot be called after teardown.');
          });

          done();
        });
      });
    });
  });
});
