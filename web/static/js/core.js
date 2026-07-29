/**
 * KHunter 前端基础设施。
 *
 * 同时暴露两层 API：
 * - apiFetch: 与 fetch 兼容，便于旧代码平滑迁移。
 * - AppApi: 自动解析响应并识别业务错误，供新代码使用。
 */
(function bootstrapAppCore(global) {
    'use strict';

    const nativeFetch = global.fetch.bind(global);
    const DEFAULT_TIMEOUT = 30000;
    const ERROR_MESSAGES = {
        400: '请求参数有误，请检查后重试',
        401: '登录状态已失效，请重新登录',
        403: '没有权限执行此操作',
        404: '请求的资源不存在',
        408: '请求超时，请稍后重试',
        429: '操作过于频繁，请稍后重试',
        500: '服务器处理失败，请稍后重试',
        502: '服务连接异常，请稍后重试',
        503: '服务暂时不可用，请稍后重试',
        504: '服务响应超时，请稍后重试'
    };

    class ApiError extends Error {
        constructor(message, options = {}) {
            super(message || '请求失败');
            this.name = 'ApiError';
            this.status = options.status || 0;
            this.code = options.code || (this.status ? `HTTP_${this.status}` : 'REQUEST_FAILED');
            this.url = options.url || '';
            this.payload = options.payload ?? null;
            this.cause = options.cause;
            this.isTimeout = Boolean(options.isTimeout);
            this.isNetworkError = Boolean(options.isNetworkError);
            this.isRetryable = this.isTimeout || this.isNetworkError || [408, 429, 502, 503, 504].includes(this.status);
        }
    }

    function extractMessage(payload, status) {
        if (payload && typeof payload === 'object') {
            const message = payload.message || payload.error || payload.detail;
            if (typeof message === 'string' && message.trim()) return message;
            if (Array.isArray(message)) return message.join('；');
        }
        if (typeof payload === 'string' && payload.trim()) {
            const text = payload.trim();
            const looksLikeHtml = /<!doctype|<html|<body/i.test(text);
            if (!looksLikeHtml && text.length <= 300) return text;
        }
        return ERROR_MESSAGES[status] || `请求失败（${status || '网络异常'}）`;
    }

    async function readErrorPayload(response) {
        const contentType = response.headers.get('content-type') || '';
        try {
            return contentType.includes('json')
                ? await response.clone().json()
                : await response.clone().text();
        } catch (_error) {
            return null;
        }
    }

    const Loading = {
        count: 0,
        timer: null,
        message: '处理中...',

        show(message = '处理中...') {
            this.count += 1;
            this.message = message;
            clearTimeout(this.timer);
            this.timer = setTimeout(() => this.render(), 180);
        },

        hide() {
            this.count = Math.max(0, this.count - 1);
            if (this.count === 0) {
                clearTimeout(this.timer);
                this.render();
            }
        },

        render() {
            const overlay = document.getElementById('global-loading');
            if (!overlay) return;
            const label = overlay.querySelector('[data-loading-message]') || overlay.querySelector('.loading-content span:last-child');
            if (label) label.textContent = this.message;
            overlay.style.display = this.count > 0 ? 'flex' : 'none';
            overlay.setAttribute('aria-hidden', this.count > 0 ? 'false' : 'true');
        },

        async run(task, message) {
            this.show(message);
            try {
                return await task();
            } finally {
                this.hide();
            }
        }
    };

    const Toast = {
        container: null,

        ensureContainer() {
            if (this.container?.isConnected) return this.container;
            this.container = document.getElementById('toast-container') || document.createElement('div');
            this.container.id = 'toast-container';
            this.container.className = 'toast-container';
            this.container.setAttribute('aria-live', 'polite');
            this.container.setAttribute('aria-atomic', 'false');
            if (!this.container.isConnected) document.body.appendChild(this.container);
            return this.container;
        },

        show(message, type = 'info', options = {}) {
            if (!message) return null;
            const toast = document.createElement('div');
            const safeType = ['success', 'error', 'warning', 'info'].includes(type) ? type : 'info';
            toast.className = `app-toast app-toast-${safeType}`;
            toast.setAttribute('role', safeType === 'error' ? 'alert' : 'status');

            const text = document.createElement('span');
            text.className = 'app-toast-message';
            text.textContent = String(message);

            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'app-toast-close';
            close.setAttribute('aria-label', '关闭提示');
            close.textContent = '×';
            close.addEventListener('click', () => this.dismiss(toast));

            toast.append(text, close);
            this.ensureContainer().appendChild(toast);
            requestAnimationFrame(() => toast.classList.add('is-visible'));

            const duration = options.duration ?? (safeType === 'error' ? 6000 : 3500);
            if (duration > 0) toast._dismissTimer = setTimeout(() => this.dismiss(toast), duration);
            return toast;
        },

        dismiss(toast) {
            if (!toast?.isConnected) return;
            clearTimeout(toast._dismissTimer);
            toast.classList.remove('is-visible');
            toast.addEventListener('transitionend', () => toast.remove(), { once: true });
            setTimeout(() => toast.remove(), 250);
        },

        success(message, options) { return this.show(message, 'success', options); },
        error(message, options) { return this.show(message, 'error', options); },
        warning(message, options) { return this.show(message, 'warning', options); },
        info(message, options) { return this.show(message, 'info', options); },

        notify(message, options) {
            const text = String(message || '');
            if (/失败|错误|异常|超时|不可用|error|failed/i.test(text)) return this.error(text, options);
            if (/成功|完成|已保存|已取消|success|completed/i.test(text)) return this.success(text, options);
            if (/请选择|请至少|请先|警告|注意|没有可|warning/i.test(text)) return this.warning(text, options);
            return this.info(text, options);
        }
    };

    function toApiError(error, context = {}) {
        if (error instanceof ApiError) return error;
        const isAbort = error?.name === 'AbortError';
        return new ApiError(isAbort ? '请求超时，请稍后重试' : '网络连接失败，请检查网络后重试', {
            code: isAbort ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
            url: context.url,
            cause: error,
            isTimeout: isAbort,
            isNetworkError: !isAbort
        });
    }

    function handleError(error, options = {}) {
        const normalized = toApiError(error, options);
        if (!options.silent) Toast.error(options.fallback || normalized.message);
        console.error('[AppError]', {
            message: normalized.message,
            code: normalized.code,
            status: normalized.status,
            url: normalized.url,
            cause: normalized.cause
        });
        return normalized;
    }

    async function apiFetch(input, options = {}) {
        const {
            timeout = DEFAULT_TIMEOUT,
            loading = String(options.method || 'GET').toUpperCase() !== 'GET',
            loadingMessage = '处理中...',
            ...fetchOptions
        } = options;
        const url = typeof input === 'string' ? input : input.url;
        const controller = new AbortController();
        let timeoutId;
        let didTimeout = false;
        const externalSignal = fetchOptions.signal;
        const abortFromExternal = () => controller.abort(externalSignal?.reason);

        if (externalSignal) {
            if (externalSignal.aborted) abortFromExternal();
            else externalSignal.addEventListener('abort', abortFromExternal, { once: true });
        }
        fetchOptions.signal = controller.signal;
        if (timeout > 0) {
            timeoutId = setTimeout(() => {
                didTimeout = true;
                controller.abort();
            }, timeout);
        }
        if (loading) Loading.show(loadingMessage);

        try {
            const response = await nativeFetch(input, fetchOptions);
            if (!response.ok) {
                const payload = await readErrorPayload(response);
                throw new ApiError(extractMessage(payload, response.status), {
                    status: response.status,
                    code: payload?.code,
                    url,
                    payload
                });
            }
            return response;
        } catch (error) {
            if (error instanceof ApiError) throw error;
            const normalized = toApiError(error, { url });
            if (didTimeout) {
                normalized.message = '请求超时，请稍后重试';
                normalized.code = 'REQUEST_TIMEOUT';
                normalized.isTimeout = true;
                normalized.isNetworkError = false;
                normalized.isRetryable = true;
            }
            throw normalized;
        } finally {
            clearTimeout(timeoutId);
            externalSignal?.removeEventListener?.('abort', abortFromExternal);
            if (loading) Loading.hide();
        }
    }

    async function request(url, options = {}) {
        const headers = new Headers(options.headers || {});
        let body = options.body;
        if (body != null && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof URLSearchParams) && !(body instanceof Blob)) {
            headers.set('Content-Type', 'application/json');
            body = JSON.stringify(body);
        }

        const response = await apiFetch(url, { ...options, headers, body });
        if (response.status === 204) return null;

        const contentType = response.headers.get('content-type') || '';
        const payload = contentType.includes('json') ? await response.json() : await response.text();
        if (payload && typeof payload === 'object' && payload.success === false) {
            throw new ApiError(extractMessage(payload, response.status), {
                status: response.status,
                code: payload.code || 'BUSINESS_ERROR',
                url,
                payload
            });
        }
        return payload;
    }

    const AppApi = {
        request,
        get(url, options) {
            return request(url, { ...options, method: 'GET' });
        },
        post(url, body, options) {
            return request(url, { ...options, method: 'POST', body });
        },
        put(url, body, options) {
            return request(url, { ...options, method: 'PUT', body });
        },
        patch(url, body, options) {
            return request(url, { ...options, method: 'PATCH', body });
        },
        delete(url, options) {
            return request(url, { ...options, method: 'DELETE' });
        }
    };

    global.ApiError = ApiError;
    global.AppApi = AppApi;
    global.AppLoading = Loading;
    global.AppToast = Toast;
    global.AppError = { handle: handleError, normalize: toApiError };
    global.apiFetch = apiFetch;

    global.addEventListener('error', event => {
        if (event.error) handleError(event.error, { silent: true });
    });
    global.addEventListener('unhandledrejection', event => {
        handleError(event.reason);
    });
})(window);
