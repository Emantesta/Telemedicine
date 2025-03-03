require('dotenv').config();
const express = require('express');
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');
const { ethers } = require('ethers');
const { body, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const winston = require('winston');
const cors = require('cors');
const { RateLimiterRedis } = require('rate-limit-redis');
const Redis = require('ioredis');
const prom = require('prom-client');
const helmet = require('helmet');
const { create } = require('ipfs-http-client');

// Configuration
const app = express();
const server = https.createServer({
    cert: fs.readFileSync(process.env.SSL_CERT_PATH),
    key: fs.readFileSync(process.env.SSL_KEY_PATH),
});
const wss = new WebSocket.Server({ server });

const redis = new Redis(process.env.REDIS_URL);
const provider = new ethers.providers.JsonRpcProvider(process.env.INFURA_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, [
    'function sonicToken() view returns (address)',
    'function registerPatient(string, address, string, bytes32, bool, bool, string, bool)',
    'function issuePrescription(address patient, bytes32 medicationHash, string dosage, uint8 refills, uint48 duration, string ipfsHash)',
    'function refillPrescription(uint256 prescriptionId)',
    'function getPatientPrescriptions(address patient, uint256 startId, uint256 limit) view returns (tuple(uint256, address, address, bytes32, string, uint48, uint48, uint8, uint8, uint48, string)[])',
    'function patients(address) view returns (bytes32, string, address, string, tuple(bool, bool, string), bytes32, bool, uint256, tuple(uint96, uint48, uint48, uint48, uint48, uint16, uint8, uint8, uint8, bool), bool)',
], wallet);
const ipfs = create({ host: 'ipfs.infura.io', port: 5001, protocol: 'https' });

// Middleware
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json());
app.use(new RateLimiterRedis({
    storeClient: redis,
    points: 100,
    duration: 15 * 60,
}));

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' }),
        new winston.transports.Console(),
    ],
});

const register = new prom.Registry();
const requestCounter = new prom.Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status'],
    registers: [register],
});
app.use((req, res, next) => {
    res.on('finish', () => requestCounter.inc({ method: req.method, route: req.path, status: res.statusCode }));
    next();
});

// Authentication Middleware
const authMiddleware = async (req, res, next) => {
    try {
        const token = req.headers['authorization']?.split(' ')[1];
        if (!token) throw new Error('Token required');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        logger.error('Auth error:', error);
        res.status(401).json({ error: 'Authentication failed', details: error.message });
    }
};

// Validation Middleware
const validateInput = (validations) => {
    return async (req, res, next) => {
        await Promise.all(validations.map(validation => validation.run(req)));
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    };
};

// Routes
app.post('/login', validateInput([
    body('address').isEthereumAddress(),
    body('signature').isHexadecimal()
]), async (req, res) => {
    try {
        const { address, signature } = req.body;
        if (ethers.utils.verifyMessage('Login to Telemedicine', signature) !== address) {
            throw new Error('Invalid signature');
        }
        const token = jwt.sign({ address }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.json({ token });
    } catch (error) {
        logger.error('Login error:', error);
        res.status(401).json({ error: 'Login failed', details: error.message });
    }
});

app.post('/register-patient', authMiddleware, validateInput([
    body('encryptedSymKey').notEmpty(),
    body('insuranceProvider').isEthereumAddress(),
    body('publicKey').notEmpty(),
    body('didHash').isHexadecimal(),
    body('notifySMS').isBoolean(),
    body('notifyEmail').isBoolean(),
    body('preferredLanguage').isLength({ max: 5 }),
    body('dataMonetizationConsent').isBoolean()
]), async (req, res) => {
    try {
        const tx = await contract.connect(wallet).registerPatient(
            req.body.encryptedSymKey,
            req.body.insuranceProvider,
            req.body.publicKey,
            ethers.utils.hexlify(req.body.didHash),
            req.body.notifySMS,
            req.body.notifyEmail,
            req.body.preferredLanguage,
            req.body.dataMonetizationConsent
        );
        await tx.wait();
        res.json({ success: true, txHash: tx.hash });
    } catch (error) {
        logger.error('Register patient error:', error);
        res.status(500).json({ error: 'Registration failed', details: error.message });
    }
});

app.post('/issue-prescription', authMiddleware, validateInput([
    body('patientAddress').isEthereumAddress(),
    body('medicationHash').isHexadecimal(),
    body('dosage').notEmpty(),
    body('refills').isInt({ min: 0, max: 10 }),
    body('duration').isInt({ min: 1 }),
    body('ipfsHash').notEmpty()
]), async (req, res) => {
    try {
        const { patientAddress, medicationHash, dosage, refills, duration, ipfsHash } = req.body;
        const tx = await contract.connect(wallet).issuePrescription(
            patientAddress,
            ethers.utils.hexlify(medicationHash),
            dosage,
            refills,
            duration,
            ipfsHash
        );
        await tx.wait();
        res.json({ success: true, txHash: tx.hash });
    } catch (error) {
        logger.error('Issue prescription error:', error);
        res.status(500).json({ error: 'Prescription issuance failed', details: error.message });
    }
});

app.post('/refill-prescription', authMiddleware, validateInput([
    body('prescriptionId').isInt({ min: 1 })
]), async (req, res) => {
    try {
        const { prescriptionId } = req.body;
        const tx = await contract.connect(wallet).refillPrescription(prescriptionId);
        await tx.wait();
        res.json({ success: true, txHash: tx.hash });
    } catch (error) {
        logger.error('Refill prescription error:', error);
        res.status(500).json({ error: 'Prescription refill failed', details: error.message });
    }
});

app.get('/patient-prescriptions/:address', authMiddleware, validateInput([
    body('startId').optional().isInt({ min: 0 }),
    body('limit').optional().isInt({ min: 1, max: 50 })
]), async (req, res) => {
    try {
        const { address } = req.params;
        const startId = req.query.startId || 0;
        const limit = req.query.limit || 10;
        const prescriptions = await contract.getPatientPrescriptions(address, startId, limit);
        res.json({ success: true, prescriptions });
    } catch (error) {
        logger.error('Get prescriptions error:', error);
        res.status(500).json({ error: 'Failed to fetch prescriptions', details: error.message });
    }
});

// AI Analysis Endpoint with IPFS Storage
app.post('/analyze-symptoms', authMiddleware, validateInput([
    body('patientAddress').isEthereumAddress(),
    body('symptoms').isString().notEmpty()
]), async (req, res) => {
    try {
        const { patientAddress, symptoms } = req.body;
        // Simulate AI analysis (replace with actual AI integration)
        const analysisResult = { diagnosis: "Potential diagnosis based on " + symptoms, timestamp: Date.now() };
        const ipfsResult = await ipfs.add(JSON.stringify(analysisResult));
        res.json({ success: true, ipfsHash: ipfsResult.path });
    } catch (error) {
        logger.error('AI analysis error:', error);
        res.status(500).json({ error: 'AI analysis failed', details: error.message });
    }
});

// Data Monetization Reward Endpoint
app.post('/monetize-data', authMiddleware, async (req, res) => {
    try {
        const patientData = await contract.patients(req.user.address);
        if (!patientData.dataMonetizationConsent) throw new Error('Consent not given');
        const sonicTokenAddr = await contract.sonicToken();
        const sonicToken = new ethers.Contract(sonicTokenAddr, [
            'function transfer(address to, uint256 amount) returns (bool)'
        ], wallet);
        const rewardAmount = ethers.utils.parseUnits("10", 18); // 10 SONIC as reward
        const tx = await sonicToken.transfer(req.user.address, rewardAmount);
        await tx.wait();
        res.json({ success: true, txHash: tx.hash, reward: "10 SONIC" });
    } catch (error) {
        logger.error('Data monetization error:', error);
        res.status(500).json({ error: 'Data monetization failed', details: error.message });
    }
});

app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
});

// Error Handling
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
});

// WebSocket
wss.on('connection', (ws) => {
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'prescriptionUpdate') {
                const prescriptions = await contract.getPatientPrescriptions(data.patientAddress, 0, 1);
                ws.send(JSON.stringify({ type: 'prescriptionStatus', data: prescriptions[0] }));
            } else if (data.type === 'aiAnalysisUpdate') {
                const content = await ipfs.cat(data.ipfsHash);
                ws.send(JSON.stringify({ type: 'aiAnalysisResult', data: JSON.parse(content.toString()) }));
            }
        } catch (error) {
            logger.error('WebSocket error:', error);
            ws.send(JSON.stringify({ error: 'Processing failed' }));
        }
    });
});

server.listen(8080, () => logger.info('Server running on port 8080'));
