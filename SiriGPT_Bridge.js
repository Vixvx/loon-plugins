/*
 * SiriGPT_Bridge.js | Loon 3.5.1(983)+
 * Experimental, not endorsed by Apple / Qwen / OpenAI.
 * Handles only matching Siri Qwen requests and never forwards Siri authentication headers.
 * No network or real-device tests can be performed by this file alone.
 */
(function () {
  "use strict";

  var TAG = "[SiriGPT] ";
  var API_ENDPOINT = "https://api.openai.com/v1/responses";
  var MAX_INPUT_CHARS = 6000000;
  var finished = false;
  var arg = typeof $argument !== "undefined" && $argument ? $argument : {};
  var key = String(arg.api_key || "").trim();
  var model = String(arg.model || "gpt-4.1-mini");
  var node = String(arg.node || "").trim();
  var isSiriRequest = typeof $request !== "undefined" && $request &&
    /^https:\/\/prod-yabuli\.qianwen\.com\/v1\/sessions\/responses(?:\?|$)/.test($request.url || "") &&
    String($request.method || "").toUpperCase() === "POST";

  function finish(output) {
    if (finished) return;
    finished = true;
    $done(output);
  }

  function log(message) {
    // IMPORTANT: Never log API keys, Siri request bodies, screenshots, or GPT answers.
    console.log(TAG + message);
  }

  function fail(reason) {
    log(reason);
    if (isSiriRequest) {
      // Fail open: continue the original request to Qwen if GPT cannot serve it.
      finish({});
    } else {
      finish({ title: "Siri-GPT 连通测试", content: "失败：" + reason });
    }
  }

  if (model !== "gpt-4.1-mini" && model !== "gpt-4.1") {
    fail("模型配置不支持");
    return;
  }
  if (!key || key.indexOf("sk-") !== 0) {
    fail("尚未设置有效形式的 OpenAI API Key，保持原始千问流程");
    return;
  }

  function readInput(body) {
    var original = JSON.parse(body);
    var content = [];
    var messages = original && original.input && Array.isArray(original.input) ? original.input : [];
    for (var i = 0; i < messages.length; i++) {
      var item = messages[i];
      if (!item || item.type !== "message" || !item.message) continue;
      if (item.message.role !== "user") continue;
      var parts = item.message.content || [];
      for (var j = 0; j < parts.length; j++) {
        var part = parts[j];
        if (!part) continue;
        if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
          content.push({ type: "input_text", text: part.text });
        } else if (part.type === "image_url" && part.image_url && typeof part.image_url.url === "string") {
          var img = part.image_url.url;
          if (/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(img) || /^https:\/\//i.test(img)) {
            content.push({ type: "input_image", image_url: img, detail: "auto" });
          }
        }
      }
    }
    return content;
  }

  function extractText(data) {
    if (typeof data.output_text === "string" && data.output_text) return data.output_text;
    var result = [];
    var out = data.output || [];
    for (var i = 0; i < out.length; i++) {
      var parts = out[i].content || [];
      for (var j = 0; j < parts.length; j++) {
        if (parts[j].type === "output_text" && typeof parts[j].text === "string") {
          result.push(parts[j].text);
        }
      }
    }
    return result.join("\n");
  }

  function makeId(prefix) {
    return prefix + Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36);
  }

  function sse(event, value) {
    var data = { type: event };
    data[event] = value;
    return "event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n";
  }

  // Event names and nesting are based on the user's 2026-11-07 HAR,
  // but IDs are generated afresh and original signed continue_url is NOT reused.
  function makeSseResponse(content, summary) {
    var createdAt = Math.floor(Date.now() / 1000);
    var sessionId = makeId("sess_");
    var responseId = makeId("resp_");
    var choiceId = makeId("choice_");
    var value = JSON.stringify({
      content: content,
      suggestions: ["", "", ""],
      summary: summary
    });
    var textPart = { type: "text", text: { annotations: [], value: value } };
    var outputItem = { type: "message", message: { role: "assistant", content: [textPart] } };
    var choice = { output: [outputItem], moderation: [], id: choiceId, status: "completed" };
    var session = {
      expires_at: createdAt + 600,
      expires_after: { seconds: 600, anchor: "last_active_at" },
      last_active_at: createdAt,
      created_at: createdAt,
      id: sessionId,
      object: "session"
    };
    var responseCreated = {
      notices: [], session_id: sessionId, created_at: createdAt,
      model: "qwenapp-apple-tqa", id: responseId,
      choices: [], object: "session.response"
    };
    var common = { choice_index: 0, item_index: 0, content_index: 0 };
    var stream = "";
    stream += sse("session.created", session);
    stream += sse("session.response.created", responseCreated);
    stream += sse("session.response.choices[].added", {
      index: 0, choice: { output: [], id: choiceId, status: "incomplete" }
    });
    stream += sse("session.response.choices[].items[].added", {
      choice_index: 0,
      item: { type: "message", message: { role: "assistant", content: [] } },
      index: 0
    });
    stream += sse("session.response.choices[].items[].message.content[].added", {
      item_index: 0, choice_index: 0, index: 0,
      content: { type: "text", text: { annotations: [], value: "" } }
    });
    var chars = Array.from(value);
    for (var pos = 0; pos < chars.length; pos += 90) {
      stream += sse("session.response.choices[].items[].message.content[].text.value.delta", {
        item_index: 0, choice_index: 0, content_index: 0,
        delta: chars.slice(pos, pos + 90).join("")
      });
    }
    stream += sse("session.response.choices[].items[].message.content[].text.value.done", {
      item_index: 0, choice_index: 0, content_index: 0, value: value
    });
    stream += sse("session.response.choices[].items[].message.content[].done", {
      item_index: 0, choice_index: 0, index: 0, content: textPart
    });
    stream += sse("session.response.choices[].items[].done", {
      choice_index: 0, item: outputItem, index: 0
    });
    stream += sse("session.response.choices[].completed", { index: 0, choice: choice });
    stream += sse("session.response.choices[].done", { index: 0, choice: choice });
    stream += sse("session.response.done", {
      notices: [], session_id: sessionId, created_at: Math.floor(Date.now() / 1000),
      model: "qwenapp-apple-vqa-siri", id: responseId,
      choices: [choice], object: "session.response"
    });
    return stream;
  }

  function parseModelAnswer(data) {
    var raw = extractText(data);
    if (!raw) throw new Error("OpenAI 未返回文字");
    var obj;
    try {
      obj = JSON.parse(raw);
    } catch (e) {
      // Future model compatibility: do not lose usable plain-text answers.
      obj = { content: raw, summary: "GPT 回答" };
    }
    if (!obj || typeof obj.content !== "string" || !obj.content.trim()) {
      throw new Error("模型回答内容为空");
    }
    return {
      content: obj.content,
      summary: typeof obj.summary === "string" && obj.summary ? obj.summary : "GPT 回答"
    };
  }

  var parts;
  if (isSiriRequest) {
    var body = $request.body;
    if (typeof body !== "string" || !body || body.length > MAX_INPUT_CHARS) {
      fail("Siri 请求体为空、不是文本或超过上限，原样放行");
      return;
    }
    try {
      parts = readInput(body);
    } catch (e) {
      fail("无法解析 Siri JSON 请求体，原样放行");
      return;
    }
    if (!parts.length) {
      fail("Siri 未携带可识别的文字/图片，原样放行");
      return;
    }
  } else {
    // A manual Generic Script is intentionally a safe, text-only connectivity test.
    parts = [{ type: "input_text", text: "请只返回这句话：Siri-GPT API 连通成功。" }];
  }

  var payload = {
    model: model,
    store: false,
    max_output_tokens: 1200,
    instructions: "你正在为中文 Siri 生成简洁、准确、自然的回答。" +
      "如果用户要求识别屏幕截图，就描述图中确实可见的内容，不要凭空猜测。" +
      "不要冒充已经控制了手机、调用了 Siri 工具或执行了紧急操作。" +
      "仅输出严格 JSON：content 为主要回答，summary 为不超过 20 个汉字的概括。",
    input: [{ role: "user", content: parts }],
    text: {
      format: {
        type: "json_schema",
        name: "siri_gpt_response",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            content: { type: "string" },
            summary: { type: "string" }
          },
          required: ["content", "summary"]
        }
      }
    }
  };

  var options = {
    url: API_ENDPOINT,
    timeout: 25000,
    insecure: false,
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload)
  };
  if (node) options.node = node;

  log(isSiriRequest ? "识别到 Siri 请求，准备调用 GPT" : "开始手动 API 连通测试");
  $httpClient.post(options, function (error, response, data) {
    if (error) {
      fail("OpenAI 请求失败（检查网络/策略和日志；不记录密钥）");
      return;
    }
    var status = response && Number(response.status || response.statusCode || 0);
    if (status < 200 || status >= 300) {
      fail("OpenAI HTTP " + status + "，请检查 API 额度、Key、模型权限");
      return;
    }
    try {
      var answer = parseModelAnswer(JSON.parse(data));
      if (isSiriRequest) {
        var syntheticSse = makeSseResponse(answer.content, answer.summary);
        log("GPT 返回成功，生成 SSE 兼容响应（Siri 端仍需真机验证）");
        finish({
          response: {
            status: 200,
            headers: {
              "Content-Type": "text/event-stream; charset=UTF-8",
              "Cache-Control": "no-cache",
              "X-SiriGPT-Bridge": "experimental-1"
            },
            body: syntheticSse
          }
        });
      } else {
        log("API 连通测试成功");
        finish({ title: "Siri-GPT API 已连通", content: answer.content });
      }
    } catch (e) {
      fail("解析 GPT 响应失败，原始请求未被替换");
    }
  });
})();
