import { type FormEvent, useEffect, useMemo, useState } from "react";
import type { AiOrganizationJob, AiOrganizationJobItem, Folder, Tag } from "@keeppage/domain";
import {
  ApiError,
  cancelAIOrganizationJob,
  createAIOrganizationJob,
  fetchAIOrganizationJob,
  fetchAIOrganizationJobItems,
  fetchAISettings,
  fetchCurrentAIOrganizationJob,
  saveAISettings,
  testAISettings,
} from "../../api";
import { Icon } from "../../components/Icon";
import { formatWhen } from "../../lib/date-format";

type Props = {
  token: string;
  folders: Folder[];
  tags: Tag[];
  onApiError: (error: unknown) => boolean;
  onBack: () => void;
  onOrganized: () => void;
};

function errorMessage(error: unknown) {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return "请求失败，请稍后重试。";
}

function isRunning(job: AiOrganizationJob | null) {
  return Boolean(job && ["queued", "classifying", "applying"].includes(job.status));
}

const itemStatusLabels: Record<AiOrganizationJobItem["status"], string> = {
  updated: "已更新",
  unchanged: "未变化",
  low_confidence: "低置信度",
  skipped: "已跳过",
};

const statusLabels: Record<AiOrganizationJob["status"], string> = {
  queued: "等待执行",
  classifying: "AI 正在归类",
  applying: "正在应用结果",
  completed: "整理完成",
  failed: "整理失败",
  cancelled: "已取消",
};

export function AIOrganizePanel({ token, folders, tags, onApiError, onBack, onOrganized }: Props) {
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [hasSavedKey, setHasSavedKey] = useState(false);
  const [keyPreview, setKeyPreview] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<"unverified" | "verified" | "failed">("unverified");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "test" | "start" | "cancel" | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [job, setJob] = useState<AiOrganizationJob | null>(null);
  const [items, setItems] = useState<AiOrganizationJobItem[]>([]);

  const taxonomyAvailable = folders.length > 0 || tags.length > 0;
  const canUseSavedKey = hasSavedKey && apiKey.trim() === "";
  const formComplete = baseUrl.trim() !== "" && model.trim() !== "" && (canUseSavedKey || apiKey.trim() !== "");
  const progress = useMemo(() => {
    if (!job || job.totalItems === 0) return 0;
    return Math.min(100, Math.round((job.processedItems / job.totalItems) * 100));
  }, [job]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchAISettings(token), fetchCurrentAIOrganizationJob(token)])
      .then(([settings, currentJob]) => {
        if (cancelled) return;
        setBaseUrl(settings.baseUrl);
        setModel(settings.model);
        setHasSavedKey(settings.hasApiKey);
        setKeyPreview(settings.keyPreview ?? "");
        setConnectionStatus(settings.connectionStatus);
        setJob(currentJob);
      })
      .catch((error) => {
        if (!cancelled && !onApiError(error)) setFeedback({ kind: "error", message: errorMessage(error) });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [onApiError, token]);

  useEffect(() => {
    if (!job || !isRunning(job)) return;
    const timer = window.setInterval(() => {
      void fetchAIOrganizationJob(job.id, token)
        .then((next) => {
          setJob(next);
          if (next.status === "completed") onOrganized();
        })
        .catch((error) => { if (!onApiError(error)) setFeedback({ kind: "error", message: errorMessage(error) }); });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status, onApiError, onOrganized, token]);

  useEffect(() => {
    if (!job || !["completed", "failed", "cancelled"].includes(job.status)) {
      setItems([]);
      return;
    }
    void fetchAIOrganizationJobItems(job.id, token)
      .then((result) => setItems(result.items))
      .catch((error) => { if (!onApiError(error)) setFeedback({ kind: "error", message: errorMessage(error) }); });
  }, [job?.id, job?.status, onApiError, token]);

  function buildInput() {
    return {
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    };
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setBusy("save"); setFeedback(null);
    try {
      const settings = await saveAISettings(buildInput(), token);
      setHasSavedKey(settings.hasApiKey); setKeyPreview(settings.keyPreview ?? ""); setApiKey("");
      setConnectionStatus(settings.connectionStatus);
      setFeedback({ kind: "success", message: "AI 配置已保存，请测试连接后开始整理。" });
    } catch (error) { if (!onApiError(error)) setFeedback({ kind: "error", message: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  async function handleTest() {
    setBusy("test"); setFeedback(null);
    try {
      const saved = await saveAISettings(buildInput(), token);
      setHasSavedKey(saved.hasApiKey);
      setKeyPreview(saved.keyPreview ?? "");
      const result = await testAISettings({ baseUrl: saved.baseUrl, model: saved.model }, token);
      setApiKey("");
      setConnectionStatus("verified");
      setFeedback({ kind: "success", message: `配置已保存并连接成功${result.responseModel ? `，响应模型 ${result.responseModel}` : ""}，耗时 ${result.latencyMs} ms。` });
    } catch (error) { setConnectionStatus("failed"); if (!onApiError(error)) setFeedback({ kind: "error", message: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  async function handleStart() {
    if (!window.confirm("将使用文章标题和网站，把所有普通书签重新划分到已有收藏夹和标签。不会创建收藏夹或标签。确认开始？")) return;
    setBusy("start"); setFeedback(null);
    try { const next = await createAIOrganizationJob(token); setJob(next); setItems([]); }
    catch (error) { if (!onApiError(error)) setFeedback({ kind: "error", message: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  async function handleCancel() {
    if (!job) return;
    setBusy("cancel");
    try { setJob(await cancelAIOrganizationJob(job.id, token)); }
    catch (error) { if (!onApiError(error)) setFeedback({ kind: "error", message: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  const running = isRunning(job);
  const connectionLabel = loading ? "正在读取配置" : connectionStatus === "verified" ? "连接已验证" : connectionStatus === "failed" ? "连接失败" : "连接待验证";
  const startHint = loading ? "正在读取模型配置。" : !taxonomyAvailable ? "先创建至少一个收藏夹或标签，再开始整理。" : connectionStatus !== "verified" ? "保存配置并测试连接后，即可开始整理。" : running ? "任务正在运行，可在下方查看进度。" : "整理会更新普通书签的收藏夹和标签，请确认后开始。";

  return (
    <section className="ai-organize-page" aria-labelledby="ai-organize-title">
      <header className="ai-organize-header settings-page-heading">
        <div>
          <p className="settings-kicker">资料库</p>
          <h1 id="ai-organize-title">AI 整理</h1>
          <p>连接你的模型服务，将书签归入已有收藏夹和标签。</p>
        </div>
        <button className="ai-organize-button is-secondary" type="button" onClick={onBack}>返回书签</button>
      </header>

      {feedback ? (
        <div className={`ai-organize-feedback is-${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>
          <Icon name={feedback.kind === "error" ? "info" : "check_circle"} />
          <p>{feedback.message}</p>
        </div>
      ) : null}

      <div className="ai-organize-grid">
        <section className="ai-organize-panel" aria-labelledby="ai-service-title">
          <header className="ai-organize-section-header">
            <div><h2 id="ai-service-title">模型服务</h2><p>使用兼容 OpenAI 接口的服务。</p></div>
            <span className={`ai-organize-status is-${connectionStatus}`}><span aria-hidden="true" />{connectionLabel}</span>
          </header>
          <form className="ai-organize-form" onSubmit={handleSave} aria-busy={loading || busy === "save" || busy === "test"}>
            <label className="ai-organize-field" htmlFor="ai-base-url">
              <span>服务地址</span>
              <input id="ai-base-url" type="url" value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); setConnectionStatus("unverified"); }} placeholder="https://api.openai.com/v1" disabled={loading || busy !== null} required aria-describedby="ai-base-url-hint" />
              <small id="ai-base-url-hint">填写服务提供方的完整 API 地址，通常以 /v1 结尾。</small>
            </label>
            <label className="ai-organize-field" htmlFor="ai-api-key">
              <span>API 密钥</span>
              <input id="ai-api-key" type="password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setConnectionStatus("unverified"); }} placeholder={hasSavedKey ? "留空使用已保存的密钥" : "输入 API 密钥"} disabled={loading || busy !== null} required={!hasSavedKey} autoComplete="new-password" aria-describedby="ai-key-hint" />
              <small id="ai-key-hint">{hasSavedKey ? `已保存密钥${keyPreview ? ` ${keyPreview}` : ""}。输入新密钥可替换。` : "密钥保存后不会完整显示。"}</small>
            </label>
            <label className="ai-organize-field" htmlFor="ai-model">
              <span>模型名称</span>
              <input id="ai-model" type="text" value={model} onChange={(event) => { setModel(event.target.value); setConnectionStatus("unverified"); }} placeholder="例如 gpt-5-mini" maxLength={120} disabled={loading || busy !== null} required aria-describedby="ai-model-hint" />
              <small id="ai-model-hint">使用服务提供方支持的模型名称。</small>
            </label>
            <footer className="ai-organize-form-footer">
              <p>测试连接会先保存当前配置。</p>
              <div className="ai-organize-actions">
                <button className="ai-organize-button is-secondary" type="button" onClick={() => void handleTest()} disabled={loading || !formComplete || busy !== null}>{busy === "test" ? "测试中…" : "测试连接"}</button>
                <button className="ai-organize-button is-primary" type="submit" disabled={loading || !formComplete || busy !== null}>{busy === "save" ? "保存中…" : "保存配置"}</button>
              </div>
            </footer>
          </form>
        </section>

        <section className="ai-organize-panel ai-organize-strategy" aria-labelledby="ai-strategy-title">
          <header className="ai-organize-section-header"><div><h2 id="ai-strategy-title">整理范围</h2><p>按现有分类整理，保持你的资料库结构。</p></div></header>
          <dl className="ai-organize-rules">
            <div><dt>处理对象</dt><dd>全部普通书签<span>私密书签不参与整理</span></dd></div>
            <div><dt>归类依据</dt><dd>标题与网站域名<span>不读取正文、完整网址或备注</span></dd></div>
            <div><dt>分类目标</dt><dd>{folders.length} 个收藏夹 · {tags.length} 个标签<span>仅使用已有分类，不创建新分类</span></dd></div>
          </dl>
          <div className="ai-organize-data-note"><Icon name="lock" /><p>发送给模型的信息包括任务临时 ID、书签标题、网站域名，以及已有收藏夹和标签名称。</p></div>
          <footer className="ai-organize-run-footer">
            <p id="ai-start-hint">{startHint}</p>
            <button className="ai-organize-button is-primary" type="button" onClick={() => void handleStart()} disabled={loading || !taxonomyAvailable || connectionStatus !== "verified" || running || busy !== null} aria-describedby="ai-start-hint">
              <Icon name="auto_awesome" /><span>{busy === "start" ? "启动中…" : running ? "整理进行中" : job?.status === "completed" ? "再次整理全部书签" : "整理全部书签"}</span>
            </button>
          </footer>
        </section>
      </div>

      <section className="ai-organize-panel ai-organize-task" aria-labelledby="ai-task-title">
        <header className="ai-organize-section-header">
          <div><h2 id="ai-task-title">最近任务</h2><p>{job ? `创建于 ${formatWhen(job.createdAt)}` : "开始整理后，可在这里查看进度和结果。"}</p></div>
          {job ? <span className={`ai-organize-job-status is-${job.status}`} role="status">{statusLabels[job.status]}</span> : null}
        </header>
        {job ? (
          <>
            <div className="ai-organize-progress">
              <div className="ai-organize-progress-label"><span>{running ? "处理进度" : "已处理书签"}</span><strong>{job.processedItems} / {job.totalItems}<small>条</small></strong></div>
              <progress aria-label="书签整理进度" max={100} value={job.status === "completed" ? 100 : progress}>{progress}%</progress>
              <div className="ai-organize-task-meta"><span>{job.completedAt ? `结束于 ${formatWhen(job.completedAt)}` : job.startedAt ? `开始于 ${formatWhen(job.startedAt)}` : "任务正在等待执行"}</span>{job && ["queued", "classifying"].includes(job.status) ? <button className="ai-organize-button is-secondary" type="button" onClick={() => void handleCancel()} disabled={busy !== null}>{busy === "cancel" ? "取消中…" : "取消任务"}</button> : null}</div>
            </div>
            {job.errorMessage ? <p className="ai-organize-task-error" role="alert">{job.errorMessage}</p> : null}
            <dl className="ai-organize-result-stats">
              <div><dt>已更新</dt><dd>{job.updatedItems}</dd></div>
              <div><dt>未变化</dt><dd>{job.unchangedItems}</dd></div>
              <div><dt>低置信度</dt><dd>{job.lowConfidenceItems}</dd></div>
              <div><dt>已跳过</dt><dd>{job.skippedItems}</dd></div>
            </dl>
            {items.length > 0 ? (
              <div className="ai-organize-results-table-wrap">
                <table className="ai-organize-results-table">
                  <caption>本次任务的书签整理结果</caption>
                  <thead><tr><th scope="col">书签</th><th scope="col">收藏夹</th><th scope="col">标签</th><th scope="col">结果</th></tr></thead>
                  <tbody>{items.map((item) => (
                    <tr key={item.bookmarkId}>
                      <td data-label="书签"><strong>{item.title || "无标题"}</strong><small>{item.site}</small></td>
                      <td data-label="收藏夹">{item.targetFolderPath || "未归类"}</td>
                      <td data-label="标签">{item.targetTags.length ? item.targetTags.join("、") : "无标签"}</td>
                      <td data-label="结果"><span className={`ai-organize-item-status is-${item.status}`}>{itemStatusLabels[item.status]}</span></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : <div className="ai-organize-empty"><Icon name="auto_awesome" /><h3>{loading ? "正在读取任务" : "还没有整理任务"}</h3><p>先配置模型并测试连接，再开始第一次整理。</p></div>}
      </section>
    </section>
  );
}
