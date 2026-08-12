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
    if (!window.confirm("将使用文章标题和网站，把所有普通文章重新划分到已有收藏夹和 Tag。不会创建任何收藏夹或 Tag。确认开始？")) return;
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

  return (
    <section className="ai-organize-page">
      <header className="ai-organize-hero">
        <div>
          <p className="eyebrow">设置</p>
          <h1>AI 整理</h1>
          <p>仅根据文章标题和网站，从你已有的收藏夹与 Tag 中选择归属。</p>
        </div>
        <button className="secondary-button" type="button" onClick={onBack}>返回书签</button>
        <div className="ai-organize-stats">
          <span><strong>{folders.length}</strong><small>已有收藏夹</small></span>
          <span><strong>{tags.length}</strong><small>已有 Tag</small></span>
          <span><strong>{connectionStatus === "verified" ? "可用" : "待配置"}</strong><small>模型连接</small></span>
        </div>
      </header>

      {feedback ? <p className={feedback.kind === "error" ? "status-banner is-error" : "status-banner"}>{feedback.message}</p> : null}

      <div className="ai-organize-grid">
        <form className="ai-organize-panel" onSubmit={handleSave}>
          <div className="ai-organize-panel-head"><Icon name="settings" /><div><p className="eyebrow">OpenAI Compatible</p><h2>模型配置</h2></div></div>
          <label className="ai-organize-field"><span>Base URL</span><input type="url" value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setConnectionStatus("unverified"); }} placeholder="https://api.openai.com/v1" disabled={loading || busy !== null} /></label>
          <label className="ai-organize-field"><span>API Key</span><input type="password" value={apiKey} onChange={(e) => { setApiKey(e.target.value); setConnectionStatus("unverified"); }} placeholder={hasSavedKey ? `${keyPreview}（留空保持不变）` : "输入 API Key"} disabled={loading || busy !== null} /></label>
          <label className="ai-organize-field"><span>模型</span><input type="text" value={model} onChange={(e) => { setModel(e.target.value); setConnectionStatus("unverified"); }} placeholder="gpt-5-mini" maxLength={120} disabled={loading || busy !== null} /></label>
          <div className="ai-organize-actions">
            <button className="secondary-button" type="button" onClick={() => void handleTest()} disabled={!formComplete || busy !== null}>{busy === "test" ? "测试中..." : "测试连接"}</button>
            <button className="primary-button" type="submit" disabled={!formComplete || busy !== null}>{busy === "save" ? "保存中..." : "保存配置"}</button>
          </div>
        </form>

        <section className="ai-organize-panel ai-organize-run-panel">
          <div className="ai-organize-panel-head"><Icon name="auto_awesome" /><div><p className="eyebrow">All Articles</p><h2>一键整理</h2></div></div>
          <div className="ai-organize-privacy"><Icon name="lock" /><p>AI 只会收到任务临时 ID、文章标题、网站域名，以及已有收藏夹和 Tag 名称。不会读取网页正文、完整 URL、备注或私密文章。</p></div>
          {!taxonomyAvailable ? <p className="status-banner is-error">请先创建至少一个收藏夹或 Tag。</p> : null}
          {job ? (
            <div className="ai-organize-progress">
              <div><strong>{statusLabels[job.status]}</strong><span>{job.processedItems} / {job.totalItems}</span></div>
              <div className="ai-organize-progress-track"><span style={{ width: `${job.status === "completed" ? 100 : progress}%` }} /></div>
              {job.errorMessage ? <p className="manager-dialog-error">{job.errorMessage}</p> : null}
            </div>
          ) : null}
          <div className="ai-organize-actions">
            {job && ["queued", "classifying"].includes(job.status) ? <button className="secondary-button" type="button" onClick={() => void handleCancel()} disabled={busy !== null}>{busy === "cancel" ? "取消中..." : "取消任务"}</button> : null}
            <button className="primary-button" type="button" onClick={() => void handleStart()} disabled={!taxonomyAvailable || connectionStatus !== "verified" || isRunning(job) || busy !== null}><Icon name="auto_awesome" /><span>{busy === "start" ? "启动中..." : job?.status === "completed" ? "再次整理" : "整理全部文章"}</span></button>
          </div>
        </section>
      </div>

      {job?.status === "completed" ? (
        <section className="ai-organize-results">
          <div className="ai-organize-panel-head"><Icon name="check_circle" /><div><p className="eyebrow">最近结果</p><h2>整理完成</h2><small>{job.completedAt ? formatWhen(job.completedAt) : ""}</small></div></div>
          <div className="ai-organize-result-stats"><span><strong>{job.updatedItems}</strong><small>已更新</small></span><span><strong>{job.unchangedItems}</strong><small>未变化</small></span><span><strong>{job.lowConfidenceItems}</strong><small>低置信度</small></span><span><strong>{job.skippedItems}</strong><small>已跳过</small></span></div>
          {items.length > 0 ? <div className="ai-organize-result-list">{items.map((item) => <article key={item.bookmarkId}><div><strong>{item.title || "无标题"}</strong><small>{item.site}</small></div><span>{item.targetFolderPath ?? "无收藏夹"}</span><span>{item.targetTags.length ? item.targetTags.join("、") : "无 Tag"}</span></article>)}</div> : null}
        </section>
      ) : null}
    </section>
  );
}
