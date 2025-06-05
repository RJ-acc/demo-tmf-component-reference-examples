const express = require('express');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const cors = require('cors');
const { v4: uuid } = require('uuid');

const PORT = process.env.PORT || 3000;
const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '2mb' }));
app.use(morgan('common'));

const qualifications = new Map();
const subscriptions = new Map();

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// --- ServiceQualification collection ---//
app.post('/serviceQualification', (req, res) => {
  const id = uuid();
  const now = new Date().toISOString();
  const body = {
    id,
    href: `${req.protocol}://${req.get('host')}/serviceQualification/${id}`,
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


app.get('/serviceQualification', (_req, res) => {
  res.json(Array.from(qualifications.values()));
});

app.get('/serviceQualification/:id', (req, res) => {
  const item = qualifications.get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not Found' });
  res.json(item);
});

app.patch('/serviceQualification/:id', (req, res) => {
  const item = qualifications.get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not Found' });
  Object.assign(item, req.body);
  res.json(item);
});

app.delete('/serviceQualification/:id', (req, res) => {
  if (!qualifications.delete(req.params.id)) return res.status(404).json({ error: 'Not Found' });
  res.status(204).end();
});

// ---- Hub ----//
app.post('/hub', (req, res) => {
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

app.get('/hub', (_req, res) => {
  res.json(Array.from(subscriptions.values()));
});

app.delete('/hub/:id', (req, res) => {
  if (!subscriptions.delete(req.params.id)) return res.status(404).json({ error: 'Not Found' });
  res.status(204).end();
});

app.listen(PORT, () => console.log('TMF645 API up on :' + PORT));



// ─── Swagger UI and Root catalog ─ //

const swaggerUi = require('swagger-ui-express');
const YAML      = require('yamljs');

// Load the OpenAPI YAML
const spec = YAML.load('./api/tmf645-openapi.yaml');

// Allow multiple Helm releases to coexist
const RELEASE_NAME = process.env.RELEASE_NAME || '';  
const BASE_PATH   = `/${RELEASE_NAME ? RELEASE_NAME + '/' : ''}tmf-api/serviceQualification/v4`;
const UI_PATH     = `${BASE_PATH}/ui`; 
const METRICS_PATH= `/${RELEASE_NAME ? RELEASE_NAME + '/' : ''}metrics`;


// ---- Swagger UI ---- //
app.use(UI_PATH,
  swaggerUi.serve,
  swaggerUi.setup(spec, { customCss: '.swagger-ui .topbar { display:none }' })
);

//----root document ---- //
app.get(BASE_PATH, (_req, res) => {
  res.json({
    _links: {
      self:                             { href: BASE_PATH,                               description: 'TMF-645 root'},
      listServiceQualification:         { href: `${BASE_PATH}/serviceQualification`,     method: 'GET',    description: 'List qualification requests'},
      createServiceQualification:       { href: `${BASE_PATH}/serviceQualification`,     method: 'POST',   description: 'Create a qualification request'},
      retrieveServiceQualification:     { href: `${BASE_PATH}/serviceQualification/{id}`,method: 'GET',    description: 'Retrieve by ID'},
      patchServiceQualification:        { href: `${BASE_PATH}/serviceQualification/{id}`,method: 'PATCH',  description: 'Update (partial) by ID'},
      deleteServiceQualification:       { href: `${BASE_PATH}/serviceQualification/{id}`,method: 'DELETE', description: 'Delete by ID'},

      listSubscription:                 { href: `${BASE_PATH}/hub`,                     method: 'GET',    description: 'List subscriptions'},
      createSubscription:               { href: `${BASE_PATH}/hub`,                     method: 'POST',   description: 'Create subscription'},
      deleteSubscription:               { href: `${BASE_PATH}/hub/{id}`,                method: 'DELETE', description: 'Delete subscription by ID'},

      metrics:                          { href: METRICS_PATH,                           method: 'GET',    description: 'Prometheus metrics'}
    }
  });
});

console.log(`Swagger UI     → ${UI_PATH}`);
console.log(`Root catalog   → ${BASE_PATH}`);

const prom = require('prom-client');

// Prometheus metrics //
prom.collectDefaultMetrics();   // built-in Node / process stats

//count HTTP requests per method + route
const httpCounter = new prom.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status']
});
app.use((req, res, next) => {
  res.on('finish', () =>
    httpCounter.inc({ method: req.method, route: req.path, status: res.statusCode })
  );
  next();
});

//metrics   //
app.get(METRICS_PATH, async (_req, res) => {
  res.set('Content-Type', prom.register.contentType);
  res.end(await prom.register.metrics());
});