const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const LOG_FILE = path.join(LOG_DIR, `bot-${new Date().toISOString().slice(0, 10)}.log`);

function pad(n) { return String(n).padStart(2, '0'); }

function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function write(level, tag, msg, extra) {
  const line = `[${timestamp()}] [${level}] [${tag}] ${msg}${extra ? ' | ' + JSON.stringify(extra) : ''}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

module.exports = {
  info:  (tag, msg, extra) => write('INFO ', tag, msg, extra),
  warn:  (tag, msg, extra) => write('WARN ', tag, msg, extra),
  error: (tag, msg, extra) => write('ERROR', tag, msg, extra),
  debug: (tag, msg, extra) => write('DEBUG', tag, msg, extra),
};