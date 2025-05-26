const { MongoClient, ObjectId } = require('mongodb');
const bodyParser = require('body-parser');
const express = require('express');
const pino = require('pino');
const expPino = require('express-pino-logger');

const logger = pino({
  level: 'info',
  transport: {
    target: 'pino-pretty'
  },
  useLevelLabels: true
});
const expLogger = expPino({ logger });

const app = express();

// Middleware
app.use(expLogger);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use((req, res, next) => {
  res.set('Timing-Allow-Origin', '*');
  res.set('Access-Control-Allow-Origin', '*');
  next();
});

// MongoDB Setup
let db;
let collection;
let mongoConnected = false;

function mongoConnect() {
  return new Promise((resolve, reject) => {
    const MONGO = process.env.MONGO === 'true';
    const DOCUMENTDB = process.env.DOCUMENTDB === 'true';

    if (MONGO) {
      const mongoURL = process.env.MONGO_URL || 'mongodb://mongodb:27017/catalogue';
      MongoClient.connect(mongoURL, (err, client) => {
        if (err) return reject(err);
        db = client.db('catalogue');
        collection = db.collection('products');
        resolve('connected');
      });
    } else if (DOCUMENTDB) {
      const mongoURL = process.env.MONGO_URL || 'mongodb://username:password@mongodb:27017/catalogue?tls=true&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false';
      MongoClient.connect(mongoURL, {
        tlsCAFile: '/app/rds-combined-ca-bundle.pem' // adjust path if needed
      }, (err, client) => {
        if (err) return reject(err);
        db = client.db('catalogue');
        collection = db.collection('products');
        resolve('connected');
      });
    } else {
      reject(new Error('No MongoDB connection mode specified. Set MONGO=true or DOCUMENTDB=true.'));
    }
  });
}

function mongoLoop() {
  mongoConnect()
    .then(() => {
      mongoConnected = true;
      logger.info('MongoDB connected');
    })
    .catch((err) => {
      logger.error('MongoDB connection failed:', err.message);
      setTimeout(mongoLoop, 2000);
    });
}

// API Endpoints
app.get('/health', (req, res) => {
  res.json({ app: 'OK', mongo: mongoConnected });
});

app.get('/products', (req, res) => {
  if (!mongoConnected) return res.status(500).send('Database not available');
  collection.find({}).toArray()
    .then(products => res.json(products))
    .catch(e => res.status(500).send(e));
});

app.get('/product/:sku', (req, res) => {
  if (!mongoConnected) return res.status(500).send('Database not available');
  const delay = process.env.GO_SLOW || 0;
  setTimeout(() => {
    collection.findOne({ sku: req.params.sku })
      .then(product => {
        if (product) res.json(product);
        else res.status(404).send('SKU not found');
      })
      .catch(e => res.status(500).send(e));
  }, delay);
});

app.get('/products/:cat', (req, res) => {
  if (!mongoConnected) return res.status(500).send('Database not available');
  collection.find({ categories: req.params.cat }).sort({ name: 1 }).toArray()
    .then(products => {
      if (products.length) res.json(products);
      else res.status(404).send(`No products for ${req.params.cat}`);
    })
    .catch(e => res.status(500).send(e));
});

app.get('/categories', (req, res) => {
  if (!mongoConnected) return res.status(500).send('Database not available');
  collection.distinct('categories')
    .then(categories => res.json(categories))
    .catch(e => res.status(500).send(e));
});

app.get('/search/:text', (req, res) => {
  if (!mongoConnected) return res.status(500).send('Database not available');
  collection.find({ $text: { $search: req.params.text } }).toArray()
    .then(results => res.json(results))
    .catch(e => res.status(500).send(e));
});

// Start Mongo connection and server
mongoLoop();

const port = process.env.CATALOGUE_SERVER_PORT || 8080;
app.listen(port, () => {
  logger.info(`Catalogue service started on port ${port}`);
});
