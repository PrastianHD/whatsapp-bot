require('dotenv').config();
const express = require('express');
const webhookRouter = require('../routes/webhook');

const app = express();

app.use(express.json());
app.use(webhookRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`WhatsApp Bot running on port ${PORT}`);
});
