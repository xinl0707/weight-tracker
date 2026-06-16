/**
 * 昕露的减肥计划 - 本地代理服务器
 *
 * 功能：
 * - 解决浏览器跨域（CORS）问题
 * - 内嵌 MiMO API Key，前端无需配置
 * - 同时提供网页服务（无需手动打开 HTML 文件）
 * - 支持图片识别（体重/食物）和文本分析
 *
 * 启动方式：双击 start.bat
 */

var http = require('http');
var https = require('https');
var url = require('url');
var fs = require('fs');
var path = require('path');

// ============ 配置 ============
// 读取 .env 文件
var envPath = require('path').join(__dirname, '.env');
try {
    var envContent = require('fs').readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(function(line) {
        var parts = line.trim().split('=');
        if (parts.length >= 2 && !process.env[parts[0]]) {
            process.env[parts[0]] = parts.slice(1).join('=');
        }
    });
} catch(e) {}

var PORT = 3000;
var MIMO_API_KEY = process.env.MIMO_API_KEY || '';
var MIMO_API_URL = 'https://api.xiaomimimo.com/v1/chat/completions';
var MIMO_MODEL = 'mimo-v2.5';
var ROOT_DIR = __dirname; // 项目根目录

// ============ 心跳 & 自动关闭 ============
var lastPing = Date.now();
var SHUTDOWN_TIMEOUT = 60000; // 60秒无心跳则关闭

setInterval(function() {
    var elapsed = Date.now() - lastPing;
    if (elapsed > SHUTDOWN_TIMEOUT) {
        console.log('\n  [Auto Shutdown] No heartbeat for 60s. Browser closed. Shutting down...\n');
        server.close();
        process.exit(0);
    }
}, 10000); // 每10秒检查一次

// MIME 类型映射
var MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

// ============ 工具函数 ============
function setCORS(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJSON(res, code, data) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

function readBody(req) {
    return new Promise(function(resolve, reject) {
        var chunks = [];
        req.on('data', function(c) { chunks.push(c); });
        req.on('end', function() {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
            catch(e) { reject(new Error('请求格式错误')); }
        });
        req.on('error', reject);
    });
}

// 静态文件服务
function serveStatic(req, res, filePath) {
    fs.stat(filePath, function(err, stats) {
        if (err || !stats.isFile()) {
            // 文件不存在，尝试 index.html
            if (path.extname(filePath) === '') {
                filePath = path.join(filePath, 'index.html');
                return serveStatic(req, res, filePath);
            }
            res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h1>404 - 文件不存在</h1><p>' + req.url + '</p>');
            return;
        }
        var ext = path.extname(filePath).toLowerCase();
        var contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
    });
}

// ============ 调用 MiMO API ============
function callMiMO(messages) {
    return new Promise(function(resolve, reject) {
        var body = JSON.stringify({
            model: MIMO_MODEL,
            messages: messages,
            max_tokens: 2048,
            temperature: 0.7
        });

        var parsed = new URL(MIMO_API_URL);
        var options = {
            hostname: parsed.hostname,
            port: 443,
            path: parsed.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': MIMO_API_KEY,
                'Content-Length': Buffer.byteLength(body)
            }
        };

        var req = https.request(options, function(res) {
            var data = '';
            res.on('data', function(chunk) { data += chunk; });
            res.on('end', function() {
                try {
                    var json = JSON.parse(data);
                    if (json.error) {
                        reject(new Error(json.error.message || JSON.stringify(json.error)));
                        return;
                    }
                    var content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
                    if (!content) {
                        reject(new Error('AI 未返回有效内容'));
                        return;
                    }
                    // 尝试提取 JSON
                    var jsonMatch = content.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        try { resolve(JSON.parse(jsonMatch[0])); }
                        catch(e) { resolve({ text: content }); }
                    } else {
                        resolve({ text: content });
                    }
                } catch(e) {
                    reject(new Error('解析响应失败: ' + e.message));
                }
            });
        });

        req.on('error', function(e) { reject(new Error('网络请求失败: ' + e.message)); });
        req.setTimeout(30000, function() { req.destroy(); reject(new Error('请求超时')); });
        req.write(body);
        req.end();
    });
}

// ============ 路由处理 ============
var server = http.createServer(function(req, res) {
    setCORS(res);

    // 预检请求
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    var parsed = url.parse(req.url, true);
    var pathname = parsed.pathname;

    // === API 路由 ===

    // 健康检查
    if (pathname === '/api/health' && req.method === 'GET') {
        lastPing = Date.now();
        sendJSON(res, 200, { status: 'ok', message: 'OK', model: MIMO_MODEL });
        return;
    }

    // 心跳
    if (pathname === '/api/ping' && req.method === 'GET') {
        lastPing = Date.now();
        sendJSON(res, 200, { pong: true });
        return;
    }

    // 图片识别
    if (pathname === '/api/recognize' && req.method === 'POST') {
        readBody(req).then(function(body) {
            if (!body.image) {
                sendJSON(res, 400, { error: 'Missing image data' });
                return;
            }
            var prompt = body.prompt || 'Please recognize this image and return JSON.';
            var messages = [{
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: body.image } }
                ]
            }];
            console.log('[Recognize] Image recognition request...');
            return callMiMO(messages);
        }).then(function(result) {
            if (result) {
                console.log('[Recognize] Success');
                sendJSON(res, 200, result);
            }
        }).catch(function(err) {
            console.error('[Recognize] Failed:', err.message);
            sendJSON(res, 500, { error: err.message });
        });
        return;
    }

    // 文本分析
    if (pathname === '/api/analyze' && req.method === 'POST') {
        readBody(req).then(function(body) {
            if (!body.prompt) {
                sendJSON(res, 400, { error: 'Missing prompt' });
                return;
            }
            var messages = [
                { role: 'system', content: '你是专业的健身教练和营养师，名叫"MIMO"。请用中文回答，语气亲切专业。使用 Markdown 格式输出，包括标题(##/###)、粗体(**)、列表(-/1.)等，让内容层次分明、易于阅读。不要在行与行之间添加多余的空行或空格。' },
                { role: 'user', content: body.prompt }
            ];
            console.log('[Analyze] Analysis request...');
            return callMiMO(messages);
        }).then(function(result) {
            if (result) {
                console.log('[Analyze] Success');
                sendJSON(res, 200, { content: result.text || JSON.stringify(result) });
            }
        }).catch(function(err) {
            console.error('[Analyze] Failed:', err.message);
            sendJSON(res, 500, { error: err.message });
        });
        return;
    }

    // === 静态文件服务 ===
    // 将 URL 路径映射到本地文件
    var filePath = path.join(ROOT_DIR, pathname === '/' ? 'index.html' : pathname);

    // 安全检查：防止目录遍历
    if (filePath.indexOf(ROOT_DIR) !== 0) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    serveStatic(req, res, filePath);
});

// 处理端口占用
server.on('error', function(err) {
    if (err.code === 'EADDRINUSE') {
        console.log('\n  Port ' + PORT + ' is in use. Trying to kill existing process...\n');
        // 尝试关闭占用端口的进程（Windows）
        if (process.platform === 'win32') {
            require('child_process').exec('for /f "tokens=5" %a in (\'netstat -ano ^| findstr :' + PORT + '\') do taskkill /F /PID %a', function() {
                // 等待1秒后重试
                setTimeout(function() {
                    server.listen(PORT);
                }, 1000);
            });
        } else {
            console.log('  Please manually kill the process using port ' + PORT);
            process.exit(1);
        }
    } else {
        console.error('Server error:', err);
    }
});

server.listen(PORT, '0.0.0.0', function() {
    // 获取局域网 IP
    var os = require('os');
    var interfaces = os.networkInterfaces();
    var lanIP = 'localhost';
    for (var name in interfaces) {
        for (var i = 0; i < interfaces[name].length; i++) {
            var iface = interfaces[name][i];
            if (iface.family === 'IPv4' && !iface.internal) {
                lanIP = iface.address;
                break;
            }
        }
        if (lanIP !== 'localhost') break;
    }

    console.log('');
    console.log('  ========================================');
    console.log('    Xinlu Weight Loss Plan - Server');
    console.log('  ========================================');
    console.log('');
    console.log('  Local:   http://localhost:' + PORT);
    console.log('  LAN:     http://' + lanIP + ':' + PORT);
    console.log('  Model:   ' + MIMO_MODEL);
    console.log('');
    console.log('  Other devices on the same WiFi can access via LAN address');
    console.log('  Do NOT close this window!');
    console.log('');

    // 自动打开浏览器
    var start = (process.platform === 'win32' ? 'start' : (process.platform === 'darwin' ? 'open' : 'xdg-open'));
    require('child_process').exec(start + ' http://localhost:' + PORT);
});
