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

// ============ 服务器端数据存储 ============
var DATA_FILE = path.join(ROOT_DIR, 'app-data.json');
var sseClients = []; // SSE 连接列表

function loadServerData() {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); }
    catch(e) { return null; }
}
function saveServerData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}
function broadcastSSE(event, data) {
    var msg = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
    sseClients = sseClients.filter(function(client) {
        try { client.write(msg); return true; }
        catch(e) { return false; }
    });
}

// ============ 心跳 & 自动关闭 ============
var lastPing = Date.now();
var SHUTDOWN_TIMEOUT = 60000; // 60秒无心跳则关闭

setInterval(function() {
    var elapsed = Date.now() - lastPing;
    if (elapsed > SHUTDOWN_TIMEOUT) {
        console.log('\n  zzz 60秒无心跳，浏览器已关闭，服务器退出中...\n');
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
function callMiMO(messages, timeout) {
    var _timeout = timeout || 30000;
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
                    var choice = json.choices && json.choices[0];
                    var msg = choice && choice.message;
                    var content = msg && (msg.content || msg.reasoning_content || '');
                    // 如果 content 为空，尝试从 refusal 或 tool_calls 中提取
                    if (!content && msg && msg.refusal) content = msg.refusal;
                    if (!content) {
                        // 详细日志：记录 MiMO 返回的完整结构，便于排查
                        console.error('  X_X AI 未返回有效内容:');
                        console.error('    finish_reason:', choice && choice.finish_reason);
                        console.error('    message keys:', msg ? Object.keys(msg) : 'N/A');
                        console.error('    raw content:', JSON.stringify(content));
                        console.error('    full choice:', JSON.stringify(choice).slice(0, 500));
                        console.error('    full response:', JSON.stringify(json).slice(0, 1000));
                        reject(new Error('AI 未返回有效内容 (reason:' + (choice && choice.finish_reason || 'unknown') + ')'));
                        return;
                    }
                    // 尝试提取 JSON（支持对象 {...} 和数组 [...]）
                    var jsonMatch = content.match(/\[[\s\S]*\]/) || content.match(/\{[\s\S]*\}/);
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
        req.setTimeout(_timeout, function() { req.destroy(); reject(new Error('请求超时 ('+Math.round(_timeout/1000)+'s)')); });
        req.write(body);
        req.end();
    });
}

// 流式输出版本
function callMiMOStream(messages, res) {
    var body = JSON.stringify({
        model: MIMO_MODEL,
        messages: messages,
        max_tokens: 2048,
        temperature: 0.7,
        stream: true
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

    var req = https.request(options, function(apiRes) {
        var buffer = '';
        apiRes.on('data', function(chunk) {
            buffer += chunk.toString();
            // 处理 SSE 格式的流式数据
            var lines = buffer.split('\n');
            buffer = lines.pop(); // 保留未完成的行
            lines.forEach(function(line) {
                line = line.trim();
                if (line.indexOf('data: ') === 0) {
                    var data = line.slice(6);
                    if (data === '[DONE]') {
                        res.write('data: [DONE]\n\n');
                        return;
                    }
                    try {
                        var json = JSON.parse(data);
                        var content = json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
                        if (content) {
                            res.write('data: ' + JSON.stringify({content: content}) + '\n\n');
                        }
                    } catch(e) {}
                }
            });
        });
        apiRes.on('end', function() {
            res.write('data: [DONE]\n\n');
            res.end();
        });
    });

    req.on('error', function(e) {
        res.write('data: ' + JSON.stringify({error: e.message}) + '\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
    });
    req.setTimeout(60000, function() { req.destroy(); });
    req.write(body);
    req.end();
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

    // 服务器信息（端口 + 局域网 IP）
    if (pathname === '/api/info' && req.method === 'GET') {
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
        sendJSON(res, 200, { port: PORT, lanIP: lanIP, url: 'http://' + lanIP + ':' + PORT });
        return;
    }

    // 流式对话（支持 AI 计划生成器的实时输出）
    if (pathname === '/api/chat/stream' && req.method === 'POST') {
        readBody(req).then(function(body) {
            if (!body.messages) {
                sendJSON(res, 400, { error: 'Missing messages' });
                return;
            }
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            });
            console.log('  >_< 流式对话响应中...');
            callMiMOStream(body.messages, res);
        }).catch(function(err) {
            sendJSON(res, 500, { error: err.message });
        });
        return;
    }

    // SSE 实时推送（客户端监听数据变更）
    if (pathname === '/api/events' && req.method === 'GET') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });
        res.write('event: connected\ndata: {}\n\n');
        sseClients.push(res);
        req.on('close', function() {
            sseClients = sseClients.filter(function(c) { return c !== res; });
        });
        return;
    }

    // 读取服务器数据
    if (pathname === '/api/data' && req.method === 'GET') {
        var data = loadServerData();
        sendJSON(res, 200, data || null);
        return;
    }

    // 保存服务器数据 + 广播给所有客户端
    if (pathname === '/api/data' && req.method === 'POST') {
        readBody(req).then(function(body) {
            saveServerData(body);
            broadcastSSE('data-updated', { timestamp: Date.now() });
            console.log('  ^_^ 数据已保存，同步到 ' + sseClients.length + ' 个设备');
            sendJSON(res, 200, { ok: true });
        }).catch(function(err) {
            sendJSON(res, 500, { error: err.message });
        });
        return;
    }

    // 图片识别 - 流式版本（SSE，实时进度 + 结果）
    if (pathname === '/api/recognize/stream' && req.method === 'POST') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });
        readBody(req).then(function(body) {
            if (!body.image) {
                res.write('event: error\ndata: ' + JSON.stringify({message:'缺少图片数据'}) + '\n\n');
                res.write('event: done\ndata: {}\n\n');
                res.end();
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
            // 进度计时器：每2秒发送一次已用时间
            var startTime = Date.now();
            var progressTimer = setInterval(function() {
                var elapsed = Math.round((Date.now() - startTime) / 1000);
                res.write('event: progress\ndata: ' + JSON.stringify({elapsed: elapsed}) + '\n\n');
            }, 2000);
            // 流式调用 MiMO API
            var body2 = JSON.stringify({
                model: MIMO_MODEL, messages: messages,
                max_tokens: 2048, temperature: 0.7, stream: true
            });
            var parsed = new URL(MIMO_API_URL);
            var options = {
                hostname: parsed.hostname, port: 443, path: parsed.pathname,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'api-key': MIMO_API_KEY, 'Content-Length': Buffer.byteLength(body2) }
            };
            var maxRetries = 3;
            var attempt = 0;
            function tryStream() {
                attempt++;
                console.log('  (...) 流式识别中... (第 ' + attempt + '/' + maxRetries + ' 次)');
                var apiReq = https.request(options, function(apiRes) {
                    var buffer = '', accumulated = '';
                    apiRes.on('data', function(chunk) {
                        buffer += chunk.toString();
                        var lines = buffer.split('\n');
                        buffer = lines.pop();
                        lines.forEach(function(line) {
                            line = line.trim();
                            if (line.indexOf('data: ') === 0) {
                                var data = line.slice(6);
                                if (data === '[DONE]') return;
                                try {
                                    var json = JSON.parse(data);
                                    var content = json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
                                    if (content) accumulated += content;
                                } catch(e) {}
                            }
                        });
                    });
                    apiRes.on('end', function() {
                        clearInterval(progressTimer);
                        // 尝试解析累积的 JSON
                        var result;
                        var jsonMatch = accumulated.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            try { result = JSON.parse(jsonMatch[0]); } catch(e) { result = {text: accumulated}; }
                        } else {
                            result = {text: accumulated};
                        }
                        var totalMs = Date.now() - startTime;
                        console.log('  ^_^ 流式识别成功 (' + Math.round(totalMs/1000) + 's)');
                        res.write('event: result\ndata: ' + JSON.stringify(result) + '\n\n');
                        res.write('event: done\ndata: ' + JSON.stringify({elapsed: Math.round(totalMs/1000)}) + '\n\n');
                        res.end();
                    });
                });
                apiReq.on('error', function(e) {
                    if (attempt < maxRetries) {
                        console.error('  ;_; 第 ' + attempt + ' 次流式识别失败:', e.message);
                        setTimeout(tryStream, attempt * 500);
                    } else {
                        clearInterval(progressTimer);
                        res.write('event: error\ndata: ' + JSON.stringify({message: '识别失败: ' + e.message}) + '\n\n');
                        res.write('event: done\ndata: {}\n\n');
                        res.end();
                    }
                });
                apiReq.setTimeout(20000, function() {
                    apiReq.destroy();
                    if (attempt < maxRetries) {
                        console.error('  ;_; 第 ' + attempt + ' 次流式识别超时');
                        setTimeout(tryStream, attempt * 500);
                    } else {
                        clearInterval(progressTimer);
                        res.write('event: error\ndata: ' + JSON.stringify({message: '识别超时，请重试'}) + '\n\n');
                        res.write('event: done\ndata: {}\n\n');
                        res.end();
                    }
                });
                apiReq.write(body2);
                apiReq.end();
            }
            tryStream();
        }).catch(function(err) {
            res.write('event: error\ndata: ' + JSON.stringify({message: err.message}) + '\n\n');
            res.write('event: done\ndata: {}\n\n');
            res.end();
        });
        return;
    }

    // 图片识别（带重试，最多3次）
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
            var maxRetries = 3;
            function tryRequest(attempt) {
                console.log('  (...) 图片识别中... (第 ' + attempt + '/' + maxRetries + ' 次)');
                return callMiMO(messages, 20000).catch(function(err) {
                    console.error('  ;_; 第 ' + attempt + ' 次识别失败:', err.message);
                    if (attempt < maxRetries) {
                        var delay = attempt * 500;
                        return new Promise(function(r) { setTimeout(r, delay); }).then(function() {
                            return tryRequest(attempt + 1);
                        });
                    }
                    throw err;
                });
            }
            return tryRequest(1);
        }).then(function(result) {
            if (result) {
                console.log('  ^_^ 识别成功');
                sendJSON(res, 200, result);
            }
        }).catch(function(err) {
            console.error('  X_X 识别失败（已重试3次）:', err.message);
            sendJSON(res, 500, { error: err.message });
        });
        return;
    }

    // 文本分析（支持单条prompt和对话messages数组）
    if (pathname === '/api/analyze' && req.method === 'POST') {
        readBody(req).then(function(body) {
            var messages;
            if (body.messages) {
                // 对话模式：直接使用传入的消息数组
                messages = body.messages;
            } else if (body.prompt) {
                // 单条模式
                messages = [
                    { role: 'system', content: '你是专业的健身教练和营养师，名叫"MIMO"。请用中文回答，语气亲切专业。使用 Markdown 格式输出，包括标题(##/###)、粗体(**)、列表(-/1.)等，让内容层次分明、易于阅读。不要在行与行之间添加多余的空行或空格。' },
                    { role: 'user', content: body.prompt }
                ];
            } else {
                sendJSON(res, 400, { error: 'Missing prompt or messages' });
                return;
            }
            console.log('  @_@ AI 分析请求 (' + (body.messages ? '对话' : '单条') + ')...');
            return callMiMO(messages, 60000);
        }).then(function(result) {
            if (result) {
                var content = result.text || JSON.stringify(result);
                console.log('  ^_^ 分析完成, 返回内容长度:', content.length, '前200字:', content.slice(0, 200));
                sendJSON(res, 200, { content: content });
            }
        }).catch(function(err) {
            console.error('  X_X 分析失败:', err.message);
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
        console.log('\n  ... 端口 ' + PORT + ' 被占用，正在尝试释放...\n');
        // 尝试关闭占用端口的进程（Windows）
        if (process.platform === 'win32') {
            require('child_process').exec('for /f "tokens=5" %a in (\'netstat -ano ^| findstr :' + PORT + '\') do taskkill /F /PID %a', function() {
                // 等待1秒后重试
                setTimeout(function() {
                    server.listen(PORT);
                }, 1000);
            });
        } else {
            console.log('  [X] 无法自动释放，请手动关闭占用端口 ' + PORT + ' 的进程');
            process.exit(1);
        }
    } else {
        console.error('  [X] 服务器错误:', err);
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
    console.log('  ==========================================');
    console.log('    ~(‾▿‾)~  昕露的减重计划  ~(‾▿‾)~');
    console.log('           服务已启动!');
    console.log('  ==========================================');
    console.log('');
    console.log('  本地访问:  http://localhost:' + PORT);
    console.log('  局域网:    http://' + lanIP + ':' + PORT);
    console.log('  AI 模型:   ' + MIMO_MODEL);
    console.log('');
    console.log('  同一 WiFi 下的设备可通过局域网地址访问');
    console.log('  请勿关闭此窗口！');
    console.log('');

    // 自动打开浏览器
    var start = (process.platform === 'win32' ? 'start' : (process.platform === 'darwin' ? 'open' : 'xdg-open'));
    require('child_process').exec(start + ' http://localhost:' + PORT);
});
