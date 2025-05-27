const redis = require('redis');
const request = require('request');
const bodyParser = require('body-parser');
const express = require('express');
const pino = require('pino');
const expPino = require('express-pino-logger');
const promClient = require('prom-client');
const Registry = promClient.Registry;
const register = new Registry();
const counter = new promClient.Counter({
    name: 'items_added',
    help: 'running count of items added to cart',
    registers: [register]
});

var redisConnected = false;

var redisHost = process.env.REDIS_HOST || '127.0.0.1'; // FIXED
var catalogueHost = process.env.CATALOGUE_HOST || 'catalogue';
var cataloguePort = process.env.CATALOGUE_PORT || '8080';

const logger = pino({
    level: 'info',
    prettyPrint: false,
    useLevelLabels: true
});
const expLogger = expPino({ logger });

const app = express();

app.use(expLogger);

app.use((req, res, next) => {
    res.set('Timing-Allow-Origin', '*');
    res.set('Access-Control-Allow-Origin', '*');
    next();
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.get('/health', (req, res) => {
    res.json({ app: 'OK', redis: redisConnected });
});

// Prometheus metrics
app.get('/metrics', (req, res) => {
    res.header('Content-Type', 'text/plain');
    res.send(register.metrics());
});

app.get('/cart/:id', (req, res) => {
    redisClient.get(req.params.id, (err, data) => {
        if (err) {
            req.log.error('ERROR', err);
            res.status(500).send(err);
        } else {
            data == null ? res.status(404).send('cart not found') : res.json(JSON.parse(data));
        }
    });
});

app.delete('/cart/:id', (req, res) => {
    redisClient.del(req.params.id, (err, data) => {
        if (err) {
            req.log.error('ERROR', err);
            res.status(500).send(err);
        } else {
            data === 1 ? res.send('OK') : res.status(404).send('cart not found');
        }
    });
});

app.get('/rename/:from/:to', (req, res) => {
    redisClient.get(req.params.from, (err, data) => {
        if (err) {
            req.log.error('ERROR', err);
            res.status(500).send(err);
        } else if (data == null) {
            res.status(404).send('cart not found');
        } else {
            const cart = JSON.parse(data);
            saveCart(req.params.to, cart)
                .then(() => res.json(cart))
                .catch(err => {
                    req.log.error(err);
                    res.status(500).send(err);
                });
        }
    });
});

app.get('/add/:id/:sku/:qty', (req, res) => {
    const qty = parseInt(req.params.qty);
    if (isNaN(qty) || qty < 1) {
        res.status(400).send('quantity must be a positive number');
        return;
    }

    getProduct(req.params.sku).then(product => {
        if (!product) return res.status(404).send('product not found');
        if (product.instock === 0) return res.status(404).send('out of stock');

        redisClient.get(req.params.id, (err, data) => {
            if (err) return res.status(500).send(err);

            const cart = data ? JSON.parse(data) : { total: 0, tax: 0, items: [] };
            const item = {
                qty,
                sku: req.params.sku,
                name: product.name,
                price: product.price,
                subtotal: qty * product.price
            };

            cart.items = mergeList(cart.items, item, qty);
            cart.total = calcTotal(cart.items);
            cart.tax = calcTax(cart.total);

            saveCart(req.params.id, cart)
                .then(() => {
                    counter.inc(qty);
                    res.json(cart);
                })
                .catch(err => res.status(500).send(err));
        });
    }).catch(err => res.status(500).send(err));
});

app.get('/update/:id/:sku/:qty', (req, res) => {
    const qty = parseInt(req.params.qty);
    if (isNaN(qty) || qty < 0) return res.status(400).send('invalid quantity');

    redisClient.get(req.params.id, (err, data) => {
        if (err) return res.status(500).send(err);
        if (!data) return res.status(404).send('cart not found');

        const cart = JSON.parse(data);
        const index = cart.items.findIndex(i => i.sku === req.params.sku);

        if (index === -1) return res.status(404).send('not in cart');
        if (qty === 0) cart.items.splice(index, 1);
        else {
            cart.items[index].qty = qty;
            cart.items[index].subtotal = qty * cart.items[index].price;
        }

        cart.total = calcTotal(cart.items);
        cart.tax = calcTax(cart.total);

        saveCart(req.params.id, cart)
            .then(() => res.json(cart))
            .catch(err => res.status(500).send(err));
    });
});

app.post('/shipping/:id', (req, res) => {
    const shipping = req.body;
    if (!shipping.distance || !shipping.cost || !shipping.location) {
        return res.status(400).send('shipping data missing');
    }

    redisClient.get(req.params.id, (err, data) => {
        if (err) return res.status(500).send(err);
        if (!data) return res.status(404).send('cart not found');

        const cart = JSON.parse(data);
        const item = {
            qty: 1,
            sku: 'SHIP',
            name: 'shipping to ' + shipping.location,
            price: shipping.cost,
            subtotal: shipping.cost
        };

        const index = cart.items.findIndex(i => i.sku === 'SHIP');
        index === -1 ? cart.items.push(item) : cart.items[index] = item;

        cart.total = calcTotal(cart.items);
        cart.tax = calcTax(cart.total);

        saveCart(req.params.id, cart)
            .then(() => res.json(cart))
            .catch(err => res.status(500).send(err));
    });
});

function mergeList(list, product, qty) {
    const index = list.findIndex(i => i.sku === product.sku);
    if (index !== -1) {
        list[index].qty += qty;
        list[index].subtotal = list[index].price * list[index].qty;
    } else {
        list.push(product);
    }
    return list;
}

function calcTotal(list) {
    return list.reduce((sum, i) => sum + i.subtotal, 0);
}

function calcTax(total) {
    return total - (total / 1.2);
}

function getProduct(sku) {
    return new Promise((resolve, reject) => {
        request(`http://${catalogueHost}:${cataloguePort}/product/${sku}`, (err, res, body) => {
            if (err) reject(err);
            else resolve(res.statusCode !== 200 ? null : JSON.parse(body));
        });
    });
}

function saveCart(id, cart) {
    logger.info('saving cart', cart);
    return new Promise((resolve, reject) => {
        redisClient.setex(id, 3600, JSON.stringify(cart), (err, data) => {
            err ? reject(err) : resolve(data);
        });
    });
}

// Redis connection
var redisClient = redis.createClient({ host: redisHost });

redisClient.on('error', (e) => {
    logger.error('Redis ERROR', e);
});
redisClient.on('ready', () => {
    logger.info('Redis READY');
    redisConnected = true;
});

// Start server
const port = process.env.CART_SERVER_PORT || '8080';
app.listen(port, () => {
    logger.info('Started on port', port);
});
