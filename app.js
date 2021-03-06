/**
 * Module dependencies.
 */
const express = require('express');
const compression = require('compression');
const session = require('express-session');
const bodyParser = require('body-parser');
const logger = require('morgan');
const chalk = require('chalk');
const errorHandler = require('errorhandler');
const lusca = require('lusca');
const dotenv = require('dotenv');
const MongoStore = require('connect-mongo')(session);
const flash = require('express-flash');
const path = require('path');
const mongoose = require('mongoose');
const passport = require('passport');
const expressValidator = require('express-validator');
const expressStatusMonitor = require('express-status-monitor');
const sass = require('node-sass-middleware');
const crypto = require('crypto');
const mime = require('mime');
var forceSsl = require('force-ssl-heroku');
var multipart = require('connect-multiparty');
var multipartMiddleware = multipart();
var CronJob = require('cron').CronJob;
var im = require('is-master/is-master.js');


const multer = require('multer');

var storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, './uploads/')
    },
    filename: function(req, file, cb) {
        crypto.pseudoRandomBytes(16, function(err, raw) {
            cb(null, raw.toString('hex') + Date.now() + '.' + mime.extension(file.mimetype));
        });
    }
});
const upload = multer({ storage: storage });

/**
 * Load environment variables from .env file, where API keys and passwords are configured.
 */
dotenv.load({ path: '.env.example' });

/**
 * Controllers (route handlers).
 */
const homeController = require('./controllers/home');
const uploadController = require('./controllers/upload');
const userController = require('./controllers/user');
const apiController = require('./controllers/api');
const contactController = require('./controllers/contact');
const restaurantController = require('./controllers/restaurant');
const orderController = require('./controllers/order');
const adminController = require('./controllers/admin');

const cronJobsController = require('./cron/cronJobs');

/**
 * API keys and Passport configuration.
 */
const passportConfig = require('./config/passport');

/**
 * Create Express server.
 */
const app = express();

/**
 * Connect to MongoDB.
 */
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI || process.env.MONGOLAB_URI);
mongoose.connection.on('connected', () => {
    console.log('%s MongoDB connection established!', chalk.green('✓'));
});
mongoose.connection.on('error', () => {
    console.log('%s MongoDB connection error. Please make sure MongoDB is running.', chalk.red('✗'));
    process.exit();
});

/**
 * Express configuration.
 */
app.use(forceSsl);
app.set('port', process.env.PORT || 3000);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');
app.use(expressStatusMonitor());
app.use(compression());
app.use(sass({
    src: path.join(__dirname, 'public'),
    dest: path.join(__dirname, 'public')
}));
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(expressValidator());
app.use(session({
    resave: true,
    saveUninitialized: true,
    secret: process.env.SESSION_SECRET,
    store: new MongoStore({
        url: process.env.MONGODB_URI || process.env.MONGOLAB_URI,
        autoReconnect: true
    })
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());
app.use((req, res, next) => {
    if (req.path === '/api/upload') {
        next();
    //} else if (req.path === '/restaurant/product') {
    //    next();
    } else if (req.path === '/restaurant/edit/picture') {
        next();
    } else if (req.path.substring(0, req.path.lastIndexOf("/") + 1) === '/restaurant/product/edit/picture/') {
        next();
    } else {
        lusca.csrf()(req, res, next);
    }
});
app.use(lusca.xframe('SAMEORIGIN'));
app.use(lusca.xssProtection(true));
app.use((req, res, next) => {
    res.locals.user = req.user;
    next();
});
app.use(function(req, res, next) {
    // After successful login, redirect back to the intended page
    if (!req.user &&
        req.path !== '/login' &&
        req.path !== '/signup' &&
        !req.path.match(/^\/auth/) &&
        !req.path.match(/\./)) {
        req.session.returnTo = req.path;
    }
    next();
});
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 31557600000 }));
app.use(express.static('uploads'));
app.use(require('prerender-node').set('prerenderToken', process.env.PRETENDER_TOKEN));

// Start the is-master worker
im.start();

// Clean old orders (Not checkedout) and phoneNumbers not verified.
var job = new CronJob('00 30 2 * * *', function() { // Runs 2:30 every day.
    if (im.isMaster) {
        console.log('I am the master, cron started (daily)');
        cronJobsController.removeOldOrders();
        cronJobsController.removePhoneNumbersNotVerified();
    }
}, null, false, "Europe/Stockholm");

job.start();

// Clean old orders (checkedout but not with email) and put back products
var jobOnceAMonth = new CronJob('0 */15 * * * *', function() { // Runs every 15 mins.
    if (im.isMaster) {
        console.log('I am the master, cron started (15 min run)');
        cronJobsController.putProductsBackNotPayed();
    }
}, null, false, "Europe/Stockholm");

jobOnceAMonth.start();

/**
 * Primary app routes.
 */
app.get('/', homeController.index);
app.get('/about', homeController.about);
app.get('/terms', homeController.terms);
app.get('/press', homeController.press);
app.get('/faq', homeController.faq);
app.get('/connect', homeController.connect);
app.get('/partners', homeController.getPartners);
app.post('/mailinglist/add', homeController.addToMailingList);
app.post('/sms/add', homeController.addToSmsNumber);
app.post('/sms/verify', homeController.verifySmsNumber);
app.get('/products/:currentCount', homeController.getProducts);
app.get('/order/:orderId', orderController.getOrderPage);
app.post('/order/', orderController.postNewOrder);
app.get('/order/product/add', orderController.addToOrder)
app.get('/order/product/delete', orderController.deleteFromOrder)
app.get('/order/checkout/:orderId', orderController.checkoutOrder)
app.post('/order/checkout/:orderId', orderController.postStripe, orderController.sendEmail)
app.get('/order/successful/resendEmail/:orderId', orderController.getOrder, orderController.sendEmail)
app.get('/order/successful/:orderId', orderController.successfulOrder)
app.get('/login', userController.getLogin);
app.post('/login', userController.postLogin);
app.get('/logout', userController.logout);
app.get('/forgot', userController.getForgot);
app.post('/forgot', userController.postForgot);
app.get('/reset/:token', userController.getReset);
app.post('/reset/:token', userController.postReset);
//app.get('/signup', userController.getSignup);
//app.post('/signup', userController.postSignup);
app.get('/signup/restaurant/:token', userController.getSignupRestaurant);
app.post('/signup/restaurant', userController.postSignupRestaurant);
//app.get('/contact', contactController.getContact);
//app.post('/contact', contactController.postContact);
app.get('/account', passportConfig.isAuthenticated, userController.getAccount);
app.post('/account/profile', passportConfig.isAuthenticated, userController.postUpdateProfile);
app.post('/account/password', passportConfig.isAuthenticated, userController.postUpdatePassword);
app.post('/account/delete', passportConfig.isAuthenticated, userController.postDeleteAccount);
app.get('/account/unlink/:provider', passportConfig.isAuthenticated, userController.getOauthUnlink);


app.get('/restaurant', passportConfig.isAuthenticatedRestaurant, restaurantController.getRestaurant);
app.get('/restaurant/edit', passportConfig.isAuthenticatedRestaurant, restaurantController.getEditRestaurant);
app.post('/restaurant/edit', passportConfig.isAuthenticatedRestaurant, restaurantController.postEditRestaurant);
app.post('/restaurant/edit/picture', passportConfig.isAuthenticatedRestaurant, multipartMiddleware,
                                     restaurantController.middlewareGetResturant,
                                     uploadController.imgUpload, uploadController.imgRemoveOld,
                                     restaurantController.saveResturant);
app.get('/restaurant/product', passportConfig.isAuthenticatedRestaurant, restaurantController.getAddProduct);
app.post('/restaurant/product', passportConfig.isAuthenticatedRestaurant, restaurantController.postAddProduct);
//app.post('/restaurant/product', passportConfig.isAuthenticatedRestaurant, multipartMiddleware, uploadController.imgUpload, restaurantController.postAddProduct);
app.post('/restaurant/product/edit/picture/:id', passportConfig.isAuthenticatedRestaurant, multipartMiddleware,
                                                 restaurantController.middlewareGetProduct,
                                                 uploadController.imgUpload, uploadController.imgRemoveOld,
                                                 restaurantController.saveProduct);
app.get('/restaurant/products/:currentCount', passportConfig.isAuthenticatedRestaurant, restaurantController.getProducts);
app.get('/restaurant/product/edit/:id', passportConfig.isAuthenticatedRestaurant, restaurantController.getEditProduct);
app.post('/restaurant/product/edit/:id', passportConfig.isAuthenticatedRestaurant, restaurantController.postEditProduct);
app.get('/restaurant/product/delete/:id', passportConfig.isAuthenticatedRestaurant, restaurantController.getDeleteProduct);
app.post('/restaurant/product/delete/:id', passportConfig.isAuthenticatedRestaurant, restaurantController.postDeleteProduct);

app.get('/restaurant/orders', passportConfig.isAuthenticatedRestaurant, restaurantController.getOrders);
app.get('/restaurant/orders/loadmore', passportConfig.isAuthenticatedRestaurant, restaurantController.getMoreOrders);
app.get('/restaurant/order/:orderId', passportConfig.isAuthenticatedRestaurant, restaurantController.getOrder);

app.get('/admin', passportConfig.isAuthenticatedAdmin, adminController.getIndex);
app.get('/admin/invite', passportConfig.isAuthenticatedAdmin, adminController.getInvite);
app.post('/admin/invite', passportConfig.isAuthenticatedAdmin, adminController.postInvite);
app.post('/admin/invite/delete/:inviteId', passportConfig.isAuthenticatedAdmin, adminController.deleteInvite);
app.get('/admin/restaurants', passportConfig.isAuthenticatedAdmin, adminController.getRestaurants);
app.get('/admin/restaurants/loadmore', passportConfig.isAuthenticatedAdmin, adminController.getMoreRestaurants);
app.post('/admin/restaurants', passportConfig.isAuthenticatedAdmin, adminController.postPretendRestaurant);

app.get('/admin/export/orders', passportConfig.isAuthenticatedAdmin, adminController.getExportOrders);
app.post('/admin/export/orders', passportConfig.isAuthenticatedAdmin, adminController.exportOrders);

app.get('/admin/sms/new', passportConfig.isAuthenticatedAdmin, adminController.smsNew);
app.post('/admin/sms/send', passportConfig.isAuthenticatedAdmin, adminController.sendSms);
app.post('/admin/sms/remove', passportConfig.isAuthenticatedAdmin, adminController.removeNumber);

/**
 * API examples routes.
 */
//app.get('/api', apiController.getApi);
//app.get('/api/lastfm', apiController.getLastfm);
//app.get('/api/nyt', apiController.getNewYorkTimes);
//app.get('/api/aviary', apiController.getAviary);
//app.get('/api/steam', passportConfig.isAuthenticated, passportConfig.isAuthorized, apiController.getSteam);
//app.get('/api/stripe', apiController.getStripe);
//app.post('/api/stripe', apiController.postStripe);
//app.get('/api/scraping', apiController.getScraping);
//app.get('/api/twilio', apiController.getTwilio);
//app.post('/api/twilio', apiController.postTwilio);
//app.get('/api/clockwork', apiController.getClockwork);
//app.post('/api/clockwork', apiController.postClockwork);
//app.get('/api/foursquare', passportConfig.isAuthenticated, passportConfig.isAuthorized, apiController.getFoursquare);
//app.get('/api/tumblr', passportConfig.isAuthenticated, passportConfig.isAuthorized, apiController.getTumblr);
//app.get('/api/facebook', passportConfig.isAuthenticated, passportConfig.isAuthorized, apiController.getFacebook);
//app.get('/api/github', passportConfig.isAuthenticated, passportConfig.isAuthorized, apiController.getGithub);
//app.get('/api/twitter', passportConfig.isAuthenticated, passportConfig.isAuthorized, apiController.getTwitter);
//app.post('/api/twitter', passportConfig.isAuthenticated, passportConfig.isAuthorized, apiController.postTwitter);
//app.get('/api/linkedin', passportConfig.isAuthenticated, passportConfig.isAuthorized, apiController.getLinkedin);
//app.get('/api/instagram', passportConfig.isAuthenticated, passportConfig.isAuthorized, apiController.getInstagram);
//app.get('/api/paypal', apiController.getPayPal);
//app.get('/api/paypal/success', apiController.getPayPalSuccess);
//app.get('/api/paypal/cancel', apiController.getPayPalCancel);
//app.get('/api/lob', apiController.getLob);
//app.get('/api/upload', apiController.getFileUpload);
//app.post('/api/upload', upload.single('myFile'), apiController.postFileUpload);
//app.get('/api/pinterest', passportConfig.isAuthenticated, passportConfig.isAuthorized, apiController.getPinterest);
//app.post('/api/pinterest', passportConfig.isAuthenticated, passportConfig.isAuthorized, apiController.postPinterest);
//app.get('/api/google-maps', apiController.getGoogleMaps);

/**
 * OAuth authentication routes. (Sign in)
 */
//app.get('/auth/instagram', passport.authenticate('instagram'));
//app.get('/auth/instagram/callback', passport.authenticate('instagram', { failureRedirect: '/login' }), (req, res) => {
    //res.redirect(req.session.returnTo || '/');
//});
//app.get('/auth/facebook', passport.authenticate('facebook', { scope: ['email', 'user_location'] }));
//app.get('/auth/facebook/callback', passport.authenticate('facebook', { failureRedirect: '/login' }), (req, res) => {
    //res.redirect(req.session.returnTo || '/');
//});
//app.get('/auth/github', passport.authenticate('github'));
//app.get('/auth/github/callback', passport.authenticate('github', { failureRedirect: '/login' }), (req, res) => {
    //res.redirect(req.session.returnTo || '/');
//});
//app.get('/auth/google', passport.authenticate('google', { scope: 'profile email' }));
//app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login' }), (req, res) => {
    //res.redirect(req.session.returnTo || '/');
//});
//app.get('/auth/twitter', passport.authenticate('twitter'));
//app.get('/auth/twitter/callback', passport.authenticate('twitter', { failureRedirect: '/login' }), (req, res) => {
    //res.redirect(req.session.returnTo || '/');
//});
//app.get('/auth/linkedin', passport.authenticate('linkedin', { state: 'SOME STATE' }));
//app.get('/auth/linkedin/callback', passport.authenticate('linkedin', { failureRedirect: '/login' }), (req, res) => {
    //res.redirect(req.session.returnTo || '/');
//});

/**
 * OAuth authorization routes. (API examples)
 */
//app.get('/auth/foursquare', passport.authorize('foursquare'));
//app.get('/auth/foursquare/callback', passport.authorize('foursquare', { failureRedirect: '/api' }), (req, res) => {
    //res.redirect('/api/foursquare');
//});
//app.get('/auth/tumblr', passport.authorize('tumblr'));
//app.get('/auth/tumblr/callback', passport.authorize('tumblr', { failureRedirect: '/api' }), (req, res) => {
    //res.redirect('/api/tumblr');
//});
//app.get('/auth/steam', passport.authorize('openid', { state: 'SOME STATE' }));
//app.get('/auth/steam/callback', passport.authorize('openid', { failureRedirect: '/login' }), (req, res) => {
    //res.redirect(req.session.returnTo || '/');
//});
//app.get('/auth/pinterest', passport.authorize('pinterest', { scope: 'read_public write_public' }));
//app.get('/auth/pinterest/callback', passport.authorize('pinterest', { failureRedirect: '/login' }), (req, res) => {
    //res.redirect('/api/pinterest');
//});

/**
 * Error Handler.
 */
app.use(errorHandler());

/**
 * Start Express server.
 */
app.listen(app.get('port'), () => {
    console.log('%s Express server listening on port %d in %s mode.', chalk.green('✓'), app.get('port'), app.get('env'));
});

module.exports = app;
