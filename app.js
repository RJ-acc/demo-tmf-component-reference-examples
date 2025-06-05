/**************************************************************************
 *  TMF-645 Service Qualification – reference implementation
 *  Prefix-aware (RELEASE_PREFIX) for TM Forum ODA Canvas deployments
 **************************************************************************/

const express = require('express');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const cors = require('cors');
const { v4: uuid } = require('uuid');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const prom = require('prom-client');

const PORT = process.env.PORT || 3000;
const RELEASE_PREFIX = process.env.RELEASE_PREFIX || '';   // e.g. tmf645-example-servicequalification
const BASE_PATH  = `/${RELEASE_PREFIX ? RELEASE_PREFIX + '/' : ''}tmf-api/serviceQualification/v4`;
const UI_PATH    = `${BASE_PATH}/ui`;
const METRICS    = `/${RELEASE_PREFIX ? RELEASE_PREFIX + '/' : ''}metrics`;
const SAMPLE_GUI = `/${RELEASE_PREFIX ? RELEASE_PREFIX + '/' : ''}sample-ui`;

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '2mb' }));
app.use(morgan('common'));

/* ───────────────────────────────────  In-memory stores  ───────────────── */
const qualifications = new Map();
const subscriptions  = new Map();

/* ─────────────────────────────────────  Health  ───────────────────────── */
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

/**************************************************************************
 *                    Business API – mounted under BASE_PATH
 **************************************************************************/
const api = express.Router();

/* ---------- ServiceQualification collection ---------- */
api.post('/serviceQualification', (req, res) => {
  const id  = uuid();
  const now = new Date().toISOString();
  const body = {
    id,
    href: `${req.protocol}://${req.get('host')}${BASE_PATH}/serviceQualification/${id}`,
    state: 'done',
    qualified: true,
    serviceability: 'Serviceable',
    '@type': 'ServiceQualification',
    '@schemaLocation': '/api/tmf645-openapi.yaml',
    qualificationResult: [{ qualificationItemResult: 'qualified' }],
    validFor: { startDateTime: now },
    ...req.body
  };
  qualifications.set(id, body);
  res.status(201).json(body);
});

api.get('/serviceQualification', (_req, res) => {
  res.json([...qualifications.values()]);
});

api.get('/serviceQualification/:id', (req, res) => {
  const item = qualifications.get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not Found' });
  res.json(item);
});

api.patch('/serviceQualification/:id', (req, res) => {
  const item = qualifications.get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not Found' });
  Object.assign(item, req.body);
  res.json(item);
});

api.delete('/serviceQualification/:id', (req, res) => {
  if (!qualifications.delete(req.params.id)) return res.status(404).json({ error: 'Not Found' });
  res.status(204).end();
});

/* --------------------------- Hub --------------------------- */
api.post('/hub', (req, res) => {
  if (!req.body.callback) return res.status(400).json({ error: 'callback URL required' });
  const id = uuid();
  const sub = {
    id,
    callback: req.body.callback,
    query: req.body.query || '',
    '@type': 'Subscription',
    '@schemaLocation': '/api/tmf645-openapi.yaml',
    _created: new Date().toISOString()
  };
  subscriptions.set(id, sub);
  res.status(201).json(sub);
});

api.get('/hub', (_req, res) => res.json([...subscriptions.values()]));

api.delete('/hub/:id', (req, res) => {
  if (!subscriptions.delete(req.params.id)) return res.status(404).json({ error: 'Not Found' });
  res.status(204).end();
});

/* ---------- Mount the router ---------- */
app.use(BASE_PATH, api);

/**************************************************************************
 *                             Docs & GUI
 **************************************************************************/
/* Swagger UI */
const spec = YAML.load('./api/tmf645-openapi.yaml');
app.use(UI_PATH, swaggerUi.serve, swaggerUi.setup(spec, {
  customCss: '.swagger-ui .topbar{display:none}'
}));

/* Root “catalog” document */
app.get(BASE_PATH, (_req, res) => {
  res.json({
    _links: {
      self:   { href: BASE_PATH },
      listServiceQualification:   { href: `${BASE_PATH}/serviceQualification`,     method: 'GET'  },
      createServiceQualification: { href: `${BASE_PATH}/serviceQualification`,     method: 'POST' },
      retrieveServiceQualification:{href: `${BASE_PATH}/serviceQualification/{id}`,method: 'GET'  },
      patchServiceQualification:  { href: `${BASE_PATH}/serviceQualification/{id}`,method: 'PATCH'},
      deleteServiceQualification: { href: `${BASE_PATH}/serviceQualification/{id}`,method: 'DELETE'},

      listSubscription:           { href: `${BASE_PATH}/hub`,         method: 'GET'  },
      createSubscription:         { href: `${BASE_PATH}/hub`,         method: 'POST' },
      deleteSubscription:         { href: `${BASE_PATH}/hub/{id}`,    method: 'DELETE' },

      metrics: { href: METRICS, method: 'GET' }
    }
  });
});

/* Sample GUI (optional) */
app.use(SAMPLE_GUI, express.static('public-sample'));

/**************************************************************************
 *                          Prometheus metrics
 **************************************************************************/
prom.collectDefaultMetrics();
const reqCounter = new prom.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status']
});
app.use((req, res, next) => {
  res.on('finish', () => reqCounter.inc({
    method: req.method,
    route:  req.route ? req.baseUrl + (req.route.path || '') : req.path,
    status: res.statusCode
  }));
  next();
});
app.get(METRICS, async (_req, res) => {
  res.set('Content-Type', prom.register.contentType);
  res.end(await prom.register.metrics());
});

/**************************************************************************
 *                              Startup
 **************************************************************************/
app.listen(PORT, () => {
  console.log(`TMF-645 API listening on :${PORT}`);
  console.log(`Swagger UI   → ${UI_PATH}`);
  console.log(`Catalog      → ${BASE_PATH}`);
  console.log(`Metrics      → ${METRICS}`);
  console.log(`Sample GUI   → ${SAMPLE_GUI}`);
});
