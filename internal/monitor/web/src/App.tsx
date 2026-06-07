import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import * as echarts from "echarts";
import {
  Activity,
  BarChart3,
  Bug,
  CheckCircle2,
  Circle,
  Clock3,
  Download,
  FileText,
  Gauge,
  Github,
  Globe2,
  LayoutDashboard,
  Loader2,
  Lock,
  Moon,
  Network,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Sun,
  Terminal,
  Trash2,
  UploadCloud,
  Wrench,
  Zap
} from "lucide-react";
import { toast } from "sonner";

import { apiJson, jsonRequest, UnauthorizedError } from "@/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useEChart } from "@/hooks/use-echart";
import { cn } from "@/lib/utils";
import type {
  ConfigNode,
  CoreSettingsForm,
  DebugResponse,
  NodeSnapshot,
  NodesResponse,
  ProbeProgress,
  SettingsResponse,
  SubscriptionConfig,
  SubscriptionStatus,
  TabId,
  ThemeMode,
  TrafficPoint,
  UpdateConfig,
  UpdateStatusResponse,
  VersionResponse
} from "@/types";

const NAV_ITEMS: Array<{ id: TabId; label: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "总览", icon: LayoutDashboard },
  { id: "manage", label: "节点", icon: Network },
  { id: "debug", label: "诊断", icon: Bug },
  { id: "logs", label: "日志", icon: Terminal },
  { id: "ota", label: "更新", icon: UploadCloud },
  { id: "settings", label: "设置", icon: Settings }
];

const REGION_OPTIONS = [
  { value: "all", label: "ALL" },
  { value: "jp", label: "JP" },
  { value: "kr", label: "KR" },
  { value: "us", label: "US" },
  { value: "hk", label: "HK" },
  { value: "tw", label: "TW" },
  { value: "sg", label: "SG" },
  { value: "other", label: "OTHER" }
];

const POOL_MODE_OPTIONS = [
  { value: "sequential", label: "sequential" },
  { value: "random", label: "random" },
  { value: "balance", label: "balance" },
  { value: "latency", label: "latency" }
];

const EMPTY_PROBE_PROGRESS: ProbeProgress = {
  visible: false,
  total: 0,
  current: 0,
  success: 0,
  failed: 0,
  percent: 0
};

const DEFAULT_CORE_FORM: CoreSettingsForm = {
  mode: "pool",
  external_ip: "",
  probe_target: "",
  skip_cert_verify: false,
  listener: {
    address: "",
    port: "",
    username: "",
    password: ""
  },
  multi_port: {
    address: "",
    base_port: "",
    username: "",
    password: ""
  },
  pool: {
    mode: "sequential",
    failure_threshold: "3",
    blacklist_duration: "24h"
  },
  management: {
    listen: "",
    password: ""
  },
  log: {
    output: "stdout",
    max_size: "50",
    max_backups: "3",
    max_age: "7",
    compress: false
  },
  geoip: {
    enabled: false,
    database_path: "",
    listen: "",
    port: "",
    auto_update_enabled: false,
    auto_update_interval: "24h",
    download_proxies: ""
  },
  subscription: {
    enabled: false,
    interval: "1h",
    urls: ""
  }
};

const DEFAULT_UPDATE_FORM: Required<UpdateConfig> = {
  enabled: false,
  channel: "stable",
  check_interval: "1h",
  proxy_base_url: "https://dl.repo.chycloud.top",
  repo: "lieyanc/easy-proxies"
};

function assertNoPayloadError(payload: { error?: string }) {
  if (payload.error) {
    throw new Error(payload.error);
  }
}

function App() {
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readThemeMode());
  const [authenticated, setAuthenticated] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [nodesData, setNodesData] = useState<NodesResponse>({ nodes: [] });
  const [lastUpdate, setLastUpdate] = useState<string>("System Online");
  const [currentRegion, setCurrentRegion] = useState("all");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus | null>(null);
  const [probeProgress, setProbeProgress] = useState<ProbeProgress>(EMPTY_PROBE_PROGRESS);
  const [isProbing, setIsProbing] = useState(false);
  const [traffic, setTraffic] = useState<TrafficPoint[]>([]);
  const [configNodes, setConfigNodes] = useState<ConfigNode[]>([]);
  const [nodeDialogOpen, setNodeDialogOpen] = useState(false);
  const [editingNodeName, setEditingNodeName] = useState("");
  const [nodeForm, setNodeForm] = useState<ConfigNode>({
    name: "",
    uri: "",
    port: undefined,
    username: "",
    password: ""
  });
  const [debugData, setDebugData] = useState<DebugResponse>({
    nodes: [],
    total_calls: 0,
    total_success: 0,
    success_rate: 0
  });
  const [logs, setLogs] = useState("");
  const [autoScrollLogs, setAutoScrollLogs] = useState(true);
  const logsRef = useRef<HTMLTextAreaElement | null>(null);
  const [coreForm, setCoreForm] = useState<CoreSettingsForm>(DEFAULT_CORE_FORM);
  const [coreSnapshot, setCoreSnapshot] = useState("");
  const [subSnapshot, setSubSnapshot] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [updateForm, setUpdateForm] = useState<Required<UpdateConfig>>(DEFAULT_UPDATE_FORM);
  const [updateSnapshot, setUpdateSnapshot] = useState("");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatusResponse | null>(null);
  const [currentVersion, setCurrentVersion] = useState("dev");
  const [otaSaving, setOtaSaving] = useState(false);
  const [loadingOverlay, setLoadingOverlay] = useState<{ title: string; detail?: string } | null>(
    null
  );
  const [githubStars, setGithubStars] = useState("-");

  const nodes = nodesData.nodes || [];
  const filteredNodes = useMemo(
    () =>
      currentRegion === "all"
        ? nodes
        : nodes.filter((node) => (node.region || "other") === currentRegion),
    [currentRegion, nodes]
  );

  const stats = useMemo(() => {
    const total = nodesData.total_nodes ?? nodes.length;
    const healthy = nodes.filter(
      (node) => !node.blacklisted && node.initial_check_done && node.available
    ).length;
    const active = nodes.reduce((sum, node) => sum + (node.active_connections || 0), 0);
    const blocked = nodes.filter(
      (node) => node.blacklisted || (!node.available && node.initial_check_done)
    ).length;
    const latestTraffic = traffic[traffic.length - 1];

    return {
      total,
      healthy,
      active,
      blocked,
      up: latestTraffic?.up || 0,
      down: latestTraffic?.down || 0
    };
  }, [nodes, nodesData.total_nodes, traffic]);

  const handleApiError = useCallback((error: unknown, fallback = "请求失败") => {
    if (error instanceof UnauthorizedError) {
      setAuthenticated(false);
      setLoginOpen(true);
      return;
    }
    toast.error(error instanceof Error ? error.message : fallback);
  }, []);

  const loadSubscriptionStatus = useCallback(async () => {
    try {
      const status = await apiJson<SubscriptionStatus>("/api/subscription/status");
      setSubscriptionStatus(status);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        setAuthenticated(false);
        setLoginOpen(true);
      }
    }
  }, []);

  const refreshNodes = useCallback(
    async (silent = false) => {
      try {
        const data = await apiJson<NodesResponse>("/api/nodes");
        setNodesData({ ...data, nodes: data.nodes || [] });
        setLastUpdate(`Sync: ${new Date().toLocaleTimeString()}`);
        setAuthenticated(true);
        setLoginOpen(false);
        void loadSubscriptionStatus();
      } catch (error) {
        if (!silent) {
          handleApiError(error, "节点数据读取失败");
        } else if (error instanceof UnauthorizedError) {
          setAuthenticated(false);
          setLoginOpen(true);
        }
      }
    },
    [handleApiError, loadSubscriptionStatus]
  );

  useEffect(() => {
    applyThemeMode(themeMode);
  }, [themeMode]);

  useEffect(() => {
    void refreshNodes(true);
  }, [refreshNodes]);

  useEffect(() => {
    if (!authenticated || !autoRefresh) return;
    const id = window.setInterval(() => {
      if (!document.hidden && activeTab === "dashboard") {
        void refreshNodes(true);
      }
    }, 10000);
    return () => window.clearInterval(id);
  }, [activeTab, authenticated, autoRefresh, refreshNodes]);

  useEffect(() => {
    if (!authenticated) return;
    if (activeTab === "manage") void loadConfigNodes();
    if (activeTab === "debug") void loadDebugData();
    if (activeTab === "settings") void loadSettingsPage();
    if (activeTab === "ota") void loadOtaPage();
  }, [activeTab, authenticated]);

  useEffect(() => {
    if (!authenticated || activeTab !== "logs") return;
    void pollLogs();
    const id = window.setInterval(() => void pollLogs(), 2000);
    return () => window.clearInterval(id);
  }, [activeTab, authenticated]);

  useEffect(() => {
    if (!authenticated) return;

    let source: EventSource | null = null;
    let reconnectTimer: number | undefined;
    let stopped = false;

    const connect = () => {
      source = new EventSource("/api/traffic");
      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as { up?: number; down?: number };
          const point = {
            time: new Date().toLocaleTimeString([], { hour12: false }),
            up: payload.up || 0,
            down: payload.down || 0
          };
          setTraffic((items) => [...items.slice(-59), point]);
        } catch {
          // Ignore malformed traffic frames.
        }
      };
      source.onerror = () => {
        source?.close();
        source = null;
        if (!stopped) {
          reconnectTimer = window.setTimeout(connect, 5000);
        }
      };
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [authenticated]);

  useEffect(() => {
    if (!autoScrollLogs || !logsRef.current) return;
    logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [autoScrollLogs, logs]);

  useEffect(() => {
    fetch("https://api.github.com/repos/lieyanc/EasyProxies")
      .then((response) => response.json())
      .then((payload: { stargazers_count?: number }) => {
        if (payload.stargazers_count !== undefined) {
          setGithubStars(String(payload.stargazers_count));
        }
      })
      .catch(() => undefined);
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");
    try {
      await apiJson<{ message: string; token?: string }>("/api/auth", {
        ...jsonRequest("POST", { password: loginPassword })
      });
      setAuthenticated(true);
      setLoginOpen(false);
      setLoginPassword("");
      await refreshNodes(true);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "登录失败");
    }
  }

  function cycleTheme() {
    const next: ThemeMode =
      themeMode === "auto" ? "dark" : themeMode === "dark" ? "light" : "auto";
    localStorage.setItem("themeMode", next);
    localStorage.removeItem("theme");
    applyThemeMode(next);
    setThemeMode(next);
  }

  async function probeNode(tag: string) {
    toast.message("探测中...");
    try {
      const payload = await apiJson<{ message?: string; latency_ms?: number; error?: string }>(
        `/api/nodes/${encodeURIComponent(tag)}/probe`,
        { method: "POST" }
      );
      assertNoPayloadError(payload);
      toast.success(`Latency: ${payload.latency_ms ?? 0}ms`);
      await refreshNodes(true);
    } catch (error) {
      handleApiError(error, "探测失败");
    }
  }

  async function releaseNode(tag: string) {
    try {
      const payload = await apiJson<{ message?: string; error?: string }>(
        `/api/nodes/${encodeURIComponent(tag)}/release`,
        {
          method: "POST"
        }
      );
      assertNoPayloadError(payload);
      toast.success(payload.message || "已解封");
      await refreshNodes(true);
    } catch (error) {
      handleApiError(error, "解封失败");
    }
  }

  async function blacklistNode(tag: string) {
    if (!window.confirm("确定拉黑该节点 24 小时？")) return;
    try {
      const payload = await apiJson<{ message?: string; error?: string }>(
        `/api/nodes/${encodeURIComponent(tag)}/blacklist`,
        jsonRequest("POST", { duration: "24h" })
      );
      assertNoPayloadError(payload);
      toast.success(payload.message || "已拉黑");
      await refreshNodes(true);
    } catch (error) {
      handleApiError(error, "拉黑失败");
    }
  }

  async function probeAllNodes() {
    if (isProbing) return;
    setIsProbing(true);
    setProbeProgress({ ...EMPTY_PROBE_PROGRESS, visible: true });
    try {
      const response = await fetch("/api/nodes/probe-all", { method: "POST" });
      if (response.status === 401) throw new UnauthorizedError();
      if (!response.ok || !response.body) throw new Error("批量探测启动失败");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let success = 0;
      let failed = 0;
      let total = 0;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = JSON.parse(line.slice(6)) as {
            type: string;
            total?: number;
            current?: number;
            progress?: number;
            success?: number;
            failed?: number;
            error?: string;
          };
          if (payload.type === "start") {
            total = payload.total || 0;
            setProbeProgress((prev) => ({ ...prev, total }));
          }
          if (payload.type === "progress") {
            if (payload.error) failed += 1;
            else success += 1;
            setProbeProgress({
              visible: true,
              total: payload.total || total,
              current: payload.current || 0,
              success,
              failed,
              percent: payload.progress || 0
            });
          }
          if (payload.type === "complete") {
            toast.success(`探测完成: 成功${payload.success || 0}, 失败${payload.failed || 0}`);
          }
        }
      }
    } catch (error) {
      handleApiError(error, "批量探测失败");
    } finally {
      setIsProbing(false);
      window.setTimeout(() => {
        setProbeProgress(EMPTY_PROBE_PROGRESS);
        void refreshNodes(true);
      }, 1600);
    }
  }

  async function exportNodes() {
    try {
      const response = await fetch("/api/export");
      if (response.status === 401) throw new UnauthorizedError();
      if (!response.ok) throw new Error("导出失败");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "nodes.txt";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      handleApiError(error, "导出失败");
    }
  }

  async function refreshSubscription() {
    try {
      const status = await apiJson<SubscriptionStatus>("/api/subscription/status");
      if (status.nodes_modified && !window.confirm("本地节点已修改，刷新将覆盖，继续？")) {
        return;
      }
      const payload = await apiJson<{ message?: string; node_count?: number }>(
        "/api/subscription/refresh",
        { method: "POST" }
      );
      toast.success(`成功获取 ${payload.node_count || 0} 节点`);
      await refreshNodes(true);
    } catch (error) {
      handleApiError(error, "订阅刷新失败");
    }
  }

  async function loadConfigNodes() {
    try {
      const payload = await apiJson<{ nodes: ConfigNode[] }>("/api/nodes/config");
      setConfigNodes(payload.nodes || []);
    } catch (error) {
      handleApiError(error, "配置节点读取失败");
    }
  }

  function openAddNodeDialog() {
    setEditingNodeName("");
    setNodeForm({ name: "", uri: "", port: undefined, username: "", password: "" });
    setNodeDialogOpen(true);
  }

  function openEditNodeDialog(node: ConfigNode) {
    setEditingNodeName(node.name);
    setNodeForm({
      name: node.name || "",
      uri: node.uri || "",
      port: node.port || undefined,
      username: node.username || "",
      password: node.password || ""
    });
    setNodeDialogOpen(true);
  }

  async function handleNodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      name: nodeForm.name.trim(),
      uri: nodeForm.uri.trim(),
      port: Number(nodeForm.port) || 0,
      username: nodeForm.username || "",
      password: nodeForm.password || ""
    };
    const url = editingNodeName
      ? `/api/nodes/config/${encodeURIComponent(editingNodeName)}`
      : "/api/nodes/config";
    const method = editingNodeName ? "PUT" : "POST";

    try {
      await apiJson<{ message: string; node: ConfigNode }>(url, jsonRequest(method, payload));
      toast.success("成功");
      setNodeDialogOpen(false);
      await loadConfigNodes();
    } catch (error) {
      handleApiError(error, "节点保存失败");
    }
  }

  async function deleteNode(name: string) {
    if (!window.confirm(`Delete ${name}?`)) return;
    try {
      await apiJson<{ message: string }>(`/api/nodes/config/${encodeURIComponent(name)}`, {
        method: "DELETE"
      });
      toast.success("删除成功");
      await loadConfigNodes();
    } catch (error) {
      handleApiError(error, "删除失败");
    }
  }

  async function triggerReload() {
    if (!window.confirm("重载核心将中断连接，确认？")) return;
    try {
      await apiJson<{ message: string }>("/api/reload", { method: "POST" });
      toast.success("重载成功");
      await refreshNodes(true);
    } catch (error) {
      handleApiError(error, "重载失败");
    }
  }

  async function loadDebugData() {
    try {
      const payload = await apiJson<DebugResponse>("/api/debug");
      setDebugData({
        nodes: payload.nodes || [],
        total_calls: payload.total_calls || 0,
        total_success: payload.total_success || 0,
        success_rate: payload.success_rate || 0
      });
    } catch (error) {
      handleApiError(error, "诊断数据读取失败");
    }
  }

  async function pollLogs() {
    try {
      const payload = await apiJson<{ logs: string }>("/api/logs");
      setLogs(payload.logs || "");
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        setAuthenticated(false);
        setLoginOpen(true);
      }
    }
  }

  async function loadSettingsPage() {
    try {
      const [settings, subscription] = await Promise.all([
        apiJson<SettingsResponse>("/api/settings"),
        apiJson<SubscriptionConfig>("/api/subscription/config").catch(() => ({
          subscriptions: [],
          enabled: false,
          interval: "1h"
        }))
      ]);
      const next = normalizeCoreForm(settings, subscription);
      setCoreForm(next);
      setCoreSnapshot(coreFormSnapshot(next));
      setSubSnapshot(subscriptionSnapshot(next));
    } catch (error) {
      handleApiError(error, "设置读取失败");
    }
  }

  async function handleSettingsSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextCoreSnapshot = coreFormSnapshot(coreForm);
    const nextSubSnapshot = subscriptionSnapshot(coreForm);
    const coreChanged = nextCoreSnapshot !== coreSnapshot;
    const subChanged = nextSubSnapshot !== subSnapshot;

    if (!coreChanged && !subChanged) {
      toast.message("配置未变更");
      return;
    }

    setSettingsSaving(true);
    try {
      if (coreChanged) {
        await apiJson<{ message: string; need_reload?: boolean }>(
          "/api/settings",
          jsonRequest("PUT", buildCorePayload(coreForm))
        );
        setCoreSnapshot(nextCoreSnapshot);
      }

      if (subChanged) {
        setLoadingOverlay({ title: "更新订阅中...", detail: "正在拉取订阅并重载节点" });
        const payload = await apiJson<{ node_count?: number; refresh_error?: string }>(
          "/api/subscription/config",
          jsonRequest("PUT", buildSubscriptionPayload(coreForm))
        );
        setSubSnapshot(nextSubSnapshot);
        if (payload.refresh_error) {
          toast.error(`订阅已保存，但刷新失败: ${payload.refresh_error}`);
        } else {
          toast.success(`已保存，获取 ${payload.node_count ?? 0} 个节点`);
        }
      } else if (coreChanged) {
        setLoadingOverlay({ title: "重载核心中...", detail: "正在应用新配置" });
        await apiJson<{ message: string }>("/api/reload", { method: "POST" });
        toast.success("已保存并重载成功");
      }

      await refreshNodes(true);
    } catch (error) {
      handleApiError(error, "设置保存失败");
    } finally {
      setSettingsSaving(false);
      setLoadingOverlay(null);
    }
  }

  async function loadOtaPage() {
    try {
      const settings = await apiJson<SettingsResponse>("/api/settings");
      const next = normalizeUpdateForm(settings.update || {});
      setUpdateForm(next);
      setUpdateSnapshot(JSON.stringify(next));
      await loadUpdateStatus();
    } catch (error) {
      handleApiError(error, "OTA 配置读取失败");
    }
  }

  async function loadUpdateStatus() {
    try {
      const [version, status] = await Promise.all([
        apiJson<VersionResponse>("/api/version"),
        apiJson<UpdateStatusResponse>("/api/update/status")
      ]);
      setCurrentVersion(version.version?.version || "dev");
      setUpdateStatus(status);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        setAuthenticated(false);
        setLoginOpen(true);
      }
    }
  }

  async function handleOtaSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSnapshot = JSON.stringify(updateForm);
    if (nextSnapshot === updateSnapshot) {
      toast.message("OTA 配置未变更");
      return;
    }
    setOtaSaving(true);
    try {
      const settings = await apiJson<SettingsResponse>("/api/settings");
      await apiJson<{ message: string }>("/api/settings", {
        ...jsonRequest("PUT", {
          ...settings,
          update: {
            enabled: updateForm.enabled,
            channel: updateForm.channel,
            check_interval: updateForm.check_interval || "1h",
            proxy_base_url: updateForm.proxy_base_url,
            repo: updateForm.repo
          }
        })
      });
      setUpdateSnapshot(nextSnapshot);
      toast.success("OTA 配置已保存");
      await loadOtaPage();
    } catch (error) {
      handleApiError(error, "OTA 配置保存失败");
    } finally {
      setOtaSaving(false);
    }
  }

  async function checkUpdateNow() {
    try {
      const payload = await apiJson<{
        ok: boolean;
        result?: { has_update?: boolean; latest_version?: string };
        error?: string;
      }>("/api/update/check", { method: "POST" });
      if (payload.ok === false) {
        toast.error(payload.error || "检查失败");
      } else if (payload.result?.has_update) {
        toast.success(`发现新版本 ${payload.result.latest_version || ""}`);
      } else {
        toast.success("当前已是最新版本");
      }
      await loadUpdateStatus();
    } catch (error) {
      handleApiError(error, "检查失败");
    }
  }

  async function applyUpdateNow() {
    setLoadingOverlay({ title: "系统更新中...", detail: "下载、校验并准备重启服务" });
    try {
      const payload = await apiJson<{ ok: boolean; status: string }>("/api/update/apply", {
        method: "POST"
      });
      toast.success(payload.status === "applying" ? "正在应用更新" : "更新任务已启动");
      await loadUpdateStatus();
    } catch (error) {
      handleApiError(error, "更新启动失败");
    } finally {
      setLoadingOverlay(null);
    }
  }

  async function dismissUpdate() {
    try {
      await apiJson<{ ok: boolean }>("/api/update/dismiss", { method: "POST" });
      toast.success("已忽略待应用更新");
      await loadUpdateStatus();
    } catch (error) {
      handleApiError(error, "忽略失败");
    }
  }

  return (
    <div className="h-screen overflow-hidden bg-muted/30 text-foreground">
      <div className="flex h-full min-h-0">
        <Sidebar activeTab={activeTab} onChange={setActiveTab} stars={githubStars} />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <Header
            activeTab={activeTab}
            onTabChange={setActiveTab}
            lastUpdate={lastUpdate}
            themeMode={themeMode}
            onThemeToggle={cycleTheme}
            autoRefresh={autoRefresh}
            onAutoRefreshToggle={() => setAutoRefresh((value) => !value)}
            onProbeAll={probeAllNodes}
            onExport={exportNodes}
            onRefresh={() => void refreshNodes(false)}
            onRefreshSubscription={refreshSubscription}
            subscriptionEnabled={Boolean(subscriptionStatus?.enabled)}
            isProbing={isProbing}
          />
          {probeProgress.visible ? <ProbeProgressBar progress={probeProgress} /> : null}
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6">
            {activeTab === "dashboard" ? (
              <DashboardView
                nodesData={nodesData}
                nodes={filteredNodes}
                allNodes={nodes}
                stats={stats}
                currentRegion={currentRegion}
                onRegionChange={setCurrentRegion}
                traffic={traffic}
                subscriptionStatus={subscriptionStatus}
                onProbe={probeNode}
                onRelease={releaseNode}
                onBlacklist={blacklistNode}
                themeMode={themeMode}
              />
            ) : null}
            {activeTab === "manage" ? (
              <ManageView
                nodes={configNodes}
                onAdd={openAddNodeDialog}
                onEdit={openEditNodeDialog}
                onDelete={deleteNode}
                onReload={triggerReload}
              />
            ) : null}
            {activeTab === "debug" ? (
              <DebugView data={debugData} themeMode={themeMode} />
            ) : null}
            {activeTab === "logs" ? (
              <LogsView
                logs={logs}
                logsRef={logsRef}
                autoScroll={autoScrollLogs}
                onAutoScrollChange={setAutoScrollLogs}
                onRefresh={pollLogs}
              />
            ) : null}
            {activeTab === "ota" ? (
              <OtaView
                form={updateForm}
                setForm={setUpdateForm}
                status={updateStatus}
                currentVersion={currentVersion}
                saving={otaSaving}
                onSubmit={handleOtaSave}
                onCheck={checkUpdateNow}
                onApply={applyUpdateNow}
                onDismiss={dismissUpdate}
              />
            ) : null}
            {activeTab === "settings" ? (
              <SettingsView
                form={coreForm}
                setForm={setCoreForm}
                saving={settingsSaving}
                onSubmit={handleSettingsSave}
              />
            ) : null}
          </div>
        </main>
      </div>
      <LoginDialog
        open={loginOpen}
        password={loginPassword}
        error={loginError}
        setPassword={setLoginPassword}
        onSubmit={handleLogin}
      />
      <NodeEditorDialog
        open={nodeDialogOpen}
        onOpenChange={setNodeDialogOpen}
        editing={Boolean(editingNodeName)}
        form={nodeForm}
        setForm={setNodeForm}
        onSubmit={handleNodeSubmit}
      />
      {loadingOverlay ? (
        <LoadingOverlay title={loadingOverlay.title} detail={loadingOverlay.detail} />
      ) : null}
    </div>
  );
}

function Sidebar({
  activeTab,
  onChange,
  stars
}: {
  activeTab: TabId;
  onChange: (tab: TabId) => void;
  stars: string;
}) {
  return (
    <aside className="hidden h-full w-64 shrink-0 border-r bg-background md:flex md:flex-col">
      <div className="flex h-14 items-center gap-3 border-b px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md border bg-muted">
          <Globe2 className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">easy-proxies</div>
          <div className="text-xs text-muted-foreground">Monitor</div>
        </div>
      </div>
      <nav className="min-h-0 flex-1 space-y-1 p-3">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <Button
              key={item.id}
              type="button"
              variant={activeTab === item.id ? "secondary" : "ghost"}
              className="w-full justify-start gap-2"
              onClick={() => onChange(item.id)}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Button>
          );
        })}
      </nav>
      <div className="border-t p-4">
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Github className="h-3.5 w-3.5" />
          <span className="font-medium text-foreground">{stars}</span>
          <span>Stars</span>
        </div>
      </div>
    </aside>
  );
}

function Header({
  activeTab,
  onTabChange,
  lastUpdate,
  themeMode,
  onThemeToggle,
  autoRefresh,
  onAutoRefreshToggle,
  onProbeAll,
  onExport,
  onRefresh,
  onRefreshSubscription,
  subscriptionEnabled,
  isProbing
}: {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  lastUpdate: string;
  themeMode: ThemeMode;
  onThemeToggle: () => void;
  autoRefresh: boolean;
  onAutoRefreshToggle: () => void;
  onProbeAll: () => void;
  onExport: () => void;
  onRefresh: () => void;
  onRefreshSubscription: () => void;
  subscriptionEnabled: boolean;
  isProbing: boolean;
}) {
  const ThemeIcon = themeMode === "dark" ? Moon : themeMode === "light" ? Sun : Circle;

  return (
    <header className="flex min-h-14 shrink-0 flex-col gap-3 border-b bg-background px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <div className="md:hidden">
          <Select value={activeTab} onValueChange={(value) => onTabChange(value as TabId)}>
            <SelectTrigger className="w-[132px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NAV_ITEMS.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Badge variant="outline" className="gap-2">
          <span className="h-2 w-2 rounded-full bg-success shadow-[0_0_0_3px_hsl(var(--success)/0.15)]" />
          {lastUpdate}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="icon" variant="ghost" onClick={onThemeToggle} title="切换主题">
          <ThemeIcon className="h-4 w-4" />
        </Button>
        <Button type="button" variant="outline" onClick={onProbeAll} disabled={isProbing}>
          {isProbing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          批量探测
        </Button>
        {subscriptionEnabled ? (
          <Button type="button" variant="outline" onClick={onRefreshSubscription}>
            <RefreshCw className="h-4 w-4" />
            刷新订阅
          </Button>
        ) : null}
        <Button type="button" variant="outline" onClick={onExport}>
          <Download className="h-4 w-4" />
          导出配置
        </Button>
        <Button type="button" variant="outline" onClick={onAutoRefreshToggle}>
          {autoRefresh ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {autoRefresh ? "关闭自动刷新" : "开启自动刷新"}
        </Button>
        <Button type="button" variant="outline" size="icon" onClick={onRefresh} title="刷新">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}

function ProbeProgressBar({ progress }: { progress: ProbeProgress }) {
  return (
    <div className="shrink-0 border-b bg-background px-4 py-3 lg:px-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <Progress value={progress.percent} className="h-2 md:flex-1" />
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="text-foreground">
            探测中: {progress.current}/{progress.total}
          </span>
          <span className="text-success">成功: {progress.success}</span>
          <span className="text-destructive">失败: {progress.failed}</span>
        </div>
      </div>
    </div>
  );
}

function DashboardView({
  nodesData,
  nodes,
  allNodes,
  stats,
  currentRegion,
  onRegionChange,
  traffic,
  subscriptionStatus,
  onProbe,
  onRelease,
  onBlacklist,
  themeMode
}: {
  nodesData: NodesResponse;
  nodes: NodeSnapshot[];
  allNodes: NodeSnapshot[];
  stats: {
    total: number;
    healthy: number;
    active: number;
    blocked: number;
    up: number;
    down: number;
  };
  currentRegion: string;
  onRegionChange: (region: string) => void;
  traffic: TrafficPoint[];
  subscriptionStatus: SubscriptionStatus | null;
  onProbe: (tag: string) => void;
  onRelease: (tag: string) => void;
  onBlacklist: (tag: string) => void;
  themeMode: ThemeMode;
}) {
  const palette = chartPalette(themeMode);
  const regionOption = useMemo(() => {
    const totals = nodesData.region_stats || {};
    const healthy = nodesData.region_healthy || {};
    const keys = Object.keys(totals).length
      ? Object.keys(totals)
      : Array.from(new Set(allNodes.map((node) => node.region || "other")));

    const data = keys.map((key) => {
      const total = totals[key] ?? allNodes.filter((node) => (node.region || "other") === key).length;
      const ok =
        healthy[key] ??
        allNodes.filter(
          (node) =>
            (node.region || "other") === key &&
            !node.blacklisted &&
            node.initial_check_done &&
            node.available
        ).length;
      return {
        name: key.toUpperCase(),
        value: total,
        itemStyle: {
          color: ok === 0 ? palette.destructive : ok < total ? palette.warning : palette.primary
        }
      };
    });

    return {
      backgroundColor: "transparent",
      tooltip: chartTooltip(themeMode),
      legend: { top: "bottom", textStyle: { color: palette.muted } },
      series: [
        {
          name: "Regions",
          type: "pie",
          radius: ["42%", "70%"],
          center: ["50%", "50%"],
          itemStyle: { borderRadius: 6, borderColor: palette.background, borderWidth: 2 },
          label: { show: false },
          emphasis: {
            label: { show: true, fontSize: 18, fontWeight: "bold", color: palette.foreground }
          },
          data
        }
      ]
    } satisfies echarts.EChartsOption;
  }, [allNodes, nodesData.region_healthy, nodesData.region_stats, themeMode]);

  const latencyOption = useMemo(() => {
    const sorted = [...allNodes]
      .filter((node) => (node.last_latency_ms || 0) > 0 && !node.blacklisted)
      .sort((a, b) => (a.last_latency_ms || 0) - (b.last_latency_ms || 0))
      .slice(0, 10)
      .reverse();
    return {
      backgroundColor: "transparent",
      tooltip: chartTooltip(themeMode),
      grid: { left: 12, right: 16, bottom: 8, top: 24, containLabel: true },
      xAxis: {
        type: "value",
        splitLine: { lineStyle: { color: palette.border, type: "dashed" } },
        axisLabel: { color: palette.muted, formatter: "{value} ms" }
      },
      yAxis: {
        type: "category",
        data: sorted.map((node) => node.name || node.tag),
        axisLabel: { color: palette.muted, width: 96, overflow: "truncate" }
      },
      series: [
        {
          name: "Latency",
          type: "bar",
          data: sorted.map((node) => node.last_latency_ms || 0),
          itemStyle: {
            color: new echarts.graphic.LinearGradient(1, 0, 0, 0, [
              { offset: 0, color: palette.success },
              { offset: 1, color: palette.primary }
            ]),
            borderRadius: [0, 4, 4, 0]
          }
        }
      ]
    } satisfies echarts.EChartsOption;
  }, [allNodes, themeMode]);

  const trafficOption = useMemo(() => {
    return {
      backgroundColor: "transparent",
      tooltip: {
        ...chartTooltip(themeMode, "axis"),
        formatter: (params: unknown) => {
          const items = Array.isArray(params) ? params : [];
          const head = items[0] as { axisValue?: string } | undefined;
          return [
            head?.axisValue || "",
            ...items.map((item) => {
              const point = item as { marker?: string; seriesName?: string; value?: number };
              return `${point.marker || ""}${point.seriesName}: ${formatBytes(point.value || 0)}/s`;
            })
          ].join("<br/>");
        }
      },
      legend: { top: "bottom", textStyle: { color: palette.muted } },
      grid: { left: 12, right: 16, bottom: 34, top: 18, containLabel: true },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: traffic.map((point) => point.time),
        axisLine: { lineStyle: { color: palette.border } },
        axisLabel: { color: palette.muted }
      },
      yAxis: {
        type: "value",
        splitLine: { lineStyle: { color: palette.border, type: "dashed" } },
        axisLabel: { color: palette.muted, formatter: (value: number) => `${formatBytes(value)}/s` }
      },
      series: [
        {
          name: "Up",
          type: "line",
          smooth: true,
          symbol: "none",
          lineStyle: { width: 2, color: palette.primary },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(37, 99, 235, 0.28)" },
              { offset: 1, color: "rgba(37, 99, 235, 0)" }
            ])
          },
          data: traffic.map((point) => point.up)
        },
        {
          name: "Down",
          type: "line",
          smooth: true,
          symbol: "none",
          lineStyle: { width: 2, color: palette.success },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(22, 163, 74, 0.28)" },
              { offset: 1, color: "rgba(22, 163, 74, 0)" }
            ])
          },
          data: traffic.map((point) => point.down)
        }
      ]
    } satisfies echarts.EChartsOption;
  }, [themeMode, traffic]);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard
          label="节点总数"
          value={stats.total}
          detail={subscriptionStatus?.enabled ? `Sub: ${subscriptionStatus.node_count ?? 0}` : ""}
          tone="default"
        />
        <MetricCard label="健康节点" value={stats.healthy} tone="success" />
        <MetricCard label="活跃连接" value={stats.active} tone="primary" />
        <MetricCard label="不可用" value={stats.blocked} tone="destructive" />
        <MetricCard label="实时上传" value={`${formatBytes(stats.up)}/s`} tone="primary" compact />
        <MetricCard label="实时下载" value={`${formatBytes(stats.down)}/s`} tone="success" compact />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard title="地域分布" option={regionOption} deps={[regionOption]} />
        <ChartCard title="最低延迟" option={latencyOption} deps={[latencyOption]} />
        <ChartCard title="实时流量" option={trafficOption} deps={[trafficOption]} />
      </div>

      <div className="flex flex-wrap gap-2">
        {REGION_OPTIONS.map((region) => (
          <Button
            key={region.value}
            type="button"
            size="sm"
            variant={currentRegion === region.value ? "default" : "outline"}
            onClick={() => onRegionChange(region.value)}
          >
            {region.label}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>节点状态</CardTitle>
            <CardDescription>当前筛选 {nodes.length} 个节点</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {nodes.length ? (
            <NodeTable
              nodes={nodes}
              onProbe={onProbe}
              onRelease={onRelease}
              onBlacklist={onBlacklist}
            />
          ) : (
            <EmptyState label="暂无数据" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ManageView({
  nodes,
  onAdd,
  onEdit,
  onDelete,
  onReload
}: {
  nodes: ConfigNode[];
  onAdd: () => void;
  onEdit: (node: ConfigNode) => void;
  onDelete: (name: string) => void;
  onReload: () => void;
}) {
  const hasSubscriptionNodes = nodes.some((node) => node.source === "subscription");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-normal">节点管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">{nodes.length} 个配置节点</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={onAdd}>
            <Plus className="h-4 w-4" />
            添加节点
          </Button>
          <Button type="button" variant="outline" onClick={onReload}>
            <Zap className="h-4 w-4" />
            重载核心
          </Button>
        </div>
      </div>

      {hasSubscriptionNodes ? (
        <Alert variant="warning">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>订阅节点</AlertTitle>
          <AlertDescription>刷新订阅可能覆盖订阅来源节点。</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {nodes.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>URI</TableHead>
                  <TableHead>端口</TableHead>
                  <TableHead>来源</TableHead>
                  <TableHead className="w-[160px]">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nodes.map((node) => (
                  <TableRow key={node.name}>
                    <TableCell className="font-medium">{node.name}</TableCell>
                    <TableCell className="max-w-[420px] truncate font-mono text-xs text-muted-foreground">
                      {node.uri}
                    </TableCell>
                    <TableCell className="font-mono">{node.port || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={node.source === "subscription" ? "warning" : "success"}>
                        {node.source || "manual"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => onEdit(node)}>
                          编辑
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => onDelete(node.name)}
                        >
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState label="暂无节点" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DebugView({ data, themeMode }: { data: DebugResponse; themeMode: ThemeMode }) {
  const palette = chartPalette(themeMode);
  const successOption = useMemo(() => {
    return {
      backgroundColor: "transparent",
      series: [
        {
          type: "gauge",
          startAngle: 180,
          endAngle: 0,
          center: ["50%", "74%"],
          radius: "92%",
          min: 0,
          max: 100,
          splitNumber: 10,
          axisLine: {
            lineStyle: {
              width: 12,
              color: [
                [0.7, palette.destructive],
                [0.9, palette.warning],
                [1, palette.success]
              ]
            }
          },
          pointer: { length: "18%", width: 6, offsetCenter: [0, "-58%"] },
          axisLabel: { color: palette.muted, fontSize: 10, distance: -42 },
          title: { offsetCenter: [0, "-18%"], fontSize: 13, color: palette.muted },
          detail: {
            fontSize: 32,
            offsetCenter: [0, "8%"],
            formatter: (value: number) => `${Math.round(value)}%`,
            color: palette.foreground
          },
          data: [{ value: data.success_rate || 0, name: "Success Rate" }]
        }
      ]
    } satisfies echarts.EChartsOption;
  }, [data.success_rate, themeMode]);

  const failureOption = useMemo(() => {
    const sorted = [...data.nodes]
      .filter((node) => (node.failure_count || 0) > 0)
      .sort((a, b) => (b.failure_count || 0) - (a.failure_count || 0))
      .slice(0, 10);
    return {
      backgroundColor: "transparent",
      tooltip: chartTooltip(themeMode),
      grid: { left: 12, right: 16, bottom: 8, top: 24, containLabel: true },
      xAxis: {
        type: "category",
        data: sorted.map((node) => node.name || node.tag),
        axisLabel: { color: palette.muted, width: 72, overflow: "truncate" }
      },
      yAxis: {
        type: "value",
        splitLine: { lineStyle: { color: palette.border, type: "dashed" } },
        axisLabel: { color: palette.muted }
      },
      series: [
        {
          name: "Failures",
          type: "bar",
          data: sorted.map((node) => node.failure_count || 0),
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: palette.destructive },
              { offset: 1, color: "#991b1b" }
            ]),
            borderRadius: [4, 4, 0, 0]
          }
        }
      ]
    } satisfies echarts.EChartsOption;
  }, [data.nodes, themeMode]);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="调用总数" value={data.total_calls || 0} />
        <MetricCard label="成功调用" value={data.total_success || 0} tone="success" />
        <MetricCard label="成功率" value={`${(data.success_rate || 0).toFixed(1)}%`} tone="primary" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="全局成功率" option={successOption} deps={[successOption]} />
        <ChartCard title="失败排行" option={failureOption} deps={[failureOption]} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>节点诊断</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.nodes.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>节点</TableHead>
                  <TableHead>成功率</TableHead>
                  <TableHead>成功/失败</TableHead>
                  <TableHead>连接</TableHead>
                  <TableHead>时间线</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.nodes.map((node) => {
                  const calls = (node.success_count || 0) + (node.failure_count || 0);
                  const rate = calls ? (((node.success_count || 0) / calls) * 100).toFixed(1) : "0.0";
                  return (
                    <TableRow key={node.tag}>
                      <TableCell>
                        <div className="font-medium">{node.name || node.tag}</div>
                        <div className="font-mono text-xs text-muted-foreground">{node.tag}</div>
                      </TableCell>
                      <TableCell className="font-mono">{rate}%</TableCell>
                      <TableCell className="font-mono">
                        <span className="text-success">{node.success_count || 0}</span>
                        <span className="px-1 text-muted-foreground">/</span>
                        <span className="text-destructive">{node.failure_count || 0}</span>
                      </TableCell>
                      <TableCell className="font-mono">{node.active_connections || 0}</TableCell>
                      <TableCell>
                        <TimelineDots node={node} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <EmptyState label="暂无诊断数据" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LogsView({
  logs,
  logsRef,
  autoScroll,
  onAutoScrollChange,
  onRefresh
}: {
  logs: string;
  logsRef: React.RefObject<HTMLTextAreaElement | null>;
  autoScroll: boolean;
  onAutoScrollChange: (checked: boolean) => void;
  onRefresh: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle>控制台日志</CardTitle>
          <CardDescription>最近缓冲日志</CardDescription>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox checked={autoScroll} onCheckedChange={(checked) => onAutoScrollChange(Boolean(checked))} />
            自动滚动
          </label>
          <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Textarea
          ref={logsRef}
          value={logs}
          readOnly
          className="h-[calc(100vh-220px)] min-h-[420px] resize-none whitespace-pre font-mono text-xs leading-6"
        />
      </CardContent>
    </Card>
  );
}

function OtaView({
  form,
  setForm,
  status,
  currentVersion,
  saving,
  onSubmit,
  onCheck,
  onApply,
  onDismiss
}: {
  form: Required<UpdateConfig>;
  setForm: React.Dispatch<React.SetStateAction<Required<UpdateConfig>>>;
  status: UpdateStatusResponse | null;
  currentVersion: string;
  saving: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCheck: () => void;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const state = status?.status?.state || (status?.enabled ? "idle" : "disabled");
  const progress = Math.max(0, Math.min(100, status?.status?.progress || 0));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-normal">OTA 更新</h1>
          <p className="mt-1 text-sm text-muted-foreground">{state}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onCheck}>
            <RefreshCw className="h-4 w-4" />
            检查更新
          </Button>
          <Button type="button" onClick={onApply}>
            <UploadCloud className="h-4 w-4" />
            下载/应用
          </Button>
          <Button type="button" variant="outline" onClick={onDismiss}>
            忽略
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="当前版本" value={currentVersion} compact />
        <MetricCard label="最新版本" value={status?.status?.latest_version || "-"} compact />
        <MetricCard label="更新状态" value={state} compact />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>更新配置</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={onSubmit}>
            <SwitchField
              label="启用后台更新检查"
              checked={form.enabled}
              onCheckedChange={(enabled) => setForm((prev) => ({ ...prev, enabled }))}
            />
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="更新通道">
                <Select
                  value={form.channel}
                  onValueChange={(channel) => setForm((prev) => ({ ...prev, channel }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stable">stable</SelectItem>
                    <SelectItem value="dev">dev</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="检查间隔">
                <Input
                  value={form.check_interval}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, check_interval: event.target.value }))
                  }
                  placeholder="1h"
                />
              </Field>
              <Field label="Release 代理">
                <Input
                  value={form.proxy_base_url}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, proxy_base_url: event.target.value }))
                  }
                  placeholder="https://dl.repo.chycloud.top"
                />
              </Field>
              <Field label="GitHub 仓库">
                <Input
                  value={form.repo}
                  onChange={(event) => setForm((prev) => ({ ...prev, repo: event.target.value }))}
                  placeholder="lieyanc/easy-proxies"
                />
              </Field>
            </div>
            <div className="space-y-2">
              <Progress value={progress} />
              <p className="line-clamp-3 text-xs text-muted-foreground">
                {status?.status?.error ||
                  status?.status?.release_notes ||
                  (status?.status?.last_check ? `上次检查: ${status.status.last_check}` : "")}
              </p>
            </div>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              保存配置
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function SettingsView({
  form,
  setForm,
  saving,
  onSubmit
}: {
  form: CoreSettingsForm;
  setForm: React.Dispatch<React.SetStateAction<CoreSettingsForm>>;
  saving: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const patch = <K extends keyof CoreSettingsForm>(key: K, value: Partial<CoreSettingsForm[K]>) => {
    setForm((prev) => ({
      ...prev,
      [key]: { ...(prev[key] as Record<string, unknown>), ...(value as Record<string, unknown>) }
    }));
  };

  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-normal">系统设置</h1>
          <p className="mt-1 text-sm text-muted-foreground">{form.mode}</p>
        </div>
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          保存设置
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="基础">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="运行模式">
              <Select
                value={form.mode}
                onValueChange={(mode) => setForm((prev) => ({ ...prev, mode }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pool">pool</SelectItem>
                  <SelectItem value="multi-port">multi-port</SelectItem>
                  <SelectItem value="hybrid">hybrid</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="外部 IP">
              <Input
                value={form.external_ip}
                onChange={(event) => setForm((prev) => ({ ...prev, external_ip: event.target.value }))}
                placeholder="0.0.0.0"
              />
            </Field>
            <Field label="探测目标">
              <Input
                value={form.probe_target}
                onChange={(event) => setForm((prev) => ({ ...prev, probe_target: event.target.value }))}
                placeholder="www.apple.com:80"
              />
            </Field>
            <SwitchField
              label="跳过 SSL 证书验证"
              checked={form.skip_cert_verify}
              onCheckedChange={(skip_cert_verify) =>
                setForm((prev) => ({ ...prev, skip_cert_verify }))
              }
            />
          </div>
        </Section>

        <Section title="单端口入口">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="监听地址">
              <Input
                value={form.listener.address}
                onChange={(event) => patch("listener", { address: event.target.value })}
              />
            </Field>
            <Field label="监听端口">
              <Input
                type="number"
                min={1}
                max={65535}
                value={form.listener.port}
                onChange={(event) => patch("listener", { port: event.target.value })}
              />
            </Field>
            <Field label="用户名">
              <Input
                value={form.listener.username}
                onChange={(event) => patch("listener", { username: event.target.value })}
              />
            </Field>
            <Field label="密码">
              <Input
                type="password"
                value={form.listener.password}
                onChange={(event) => patch("listener", { password: event.target.value })}
              />
            </Field>
          </div>
        </Section>

        <Section title="多端口入口">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="监听地址">
              <Input
                value={form.multi_port.address}
                onChange={(event) => patch("multi_port", { address: event.target.value })}
              />
            </Field>
            <Field label="起始端口">
              <Input
                type="number"
                min={1}
                max={65535}
                value={form.multi_port.base_port}
                onChange={(event) => patch("multi_port", { base_port: event.target.value })}
              />
            </Field>
            <Field label="用户名">
              <Input
                value={form.multi_port.username}
                onChange={(event) => patch("multi_port", { username: event.target.value })}
              />
            </Field>
            <Field label="密码">
              <Input
                type="password"
                value={form.multi_port.password}
                onChange={(event) => patch("multi_port", { password: event.target.value })}
              />
            </Field>
          </div>
        </Section>

        <Section title="代理池">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="调度模式">
              <Select
                value={form.pool.mode}
                onValueChange={(mode) => patch("pool", { mode })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POOL_MODE_OPTIONS.map((mode) => (
                    <SelectItem key={mode.value} value={mode.value}>
                      {mode.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="故障阈值">
              <Input
                type="number"
                min={1}
                value={form.pool.failure_threshold}
                onChange={(event) => patch("pool", { failure_threshold: event.target.value })}
              />
            </Field>
            <Field label="黑名单时长">
              <Input
                value={form.pool.blacklist_duration}
                onChange={(event) => patch("pool", { blacklist_duration: event.target.value })}
              />
            </Field>
          </div>
        </Section>

        <Section title="管理端">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="监听地址">
              <Input
                value={form.management.listen}
                onChange={(event) => patch("management", { listen: event.target.value })}
                placeholder="0.0.0.0:8080"
              />
            </Field>
            <Field label="访问密码">
              <Input
                type="password"
                value={form.management.password}
                onChange={(event) => patch("management", { password: event.target.value })}
              />
            </Field>
          </div>
        </Section>

        <Section title="GeoIP">
          <div className="grid gap-4 md:grid-cols-2">
            <SwitchField
              label="启用 GeoIP 地域路由"
              checked={form.geoip.enabled}
              onCheckedChange={(enabled) => patch("geoip", { enabled })}
            />
            <SwitchField
              label="自动更新数据库"
              checked={form.geoip.auto_update_enabled}
              onCheckedChange={(auto_update_enabled) => patch("geoip", { auto_update_enabled })}
            />
            <Field label="数据库路径">
              <Input
                value={form.geoip.database_path}
                onChange={(event) => patch("geoip", { database_path: event.target.value })}
              />
            </Field>
            <Field label="路由监听地址">
              <Input
                value={form.geoip.listen}
                onChange={(event) => patch("geoip", { listen: event.target.value })}
              />
            </Field>
            <Field label="路由端口">
              <Input
                type="number"
                min={1}
                max={65535}
                value={form.geoip.port}
                onChange={(event) => patch("geoip", { port: event.target.value })}
              />
            </Field>
            <Field label="更新间隔">
              <Input
                value={form.geoip.auto_update_interval}
                onChange={(event) => patch("geoip", { auto_update_interval: event.target.value })}
              />
            </Field>
            <Field label="下载代理" className="md:col-span-2">
              <Textarea
                value={form.geoip.download_proxies}
                onChange={(event) => patch("geoip", { download_proxies: event.target.value })}
                className="min-h-24 resize-y font-mono text-xs"
              />
            </Field>
          </div>
        </Section>

        <Section title="日志">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="输出位置">
              <Select
                value={form.log.output}
                onValueChange={(output) => patch("log", { output })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdout">stdout</SelectItem>
                  <SelectItem value="file">file</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <SwitchField
              label="压缩旧日志"
              checked={form.log.compress}
              onCheckedChange={(compress) => patch("log", { compress })}
            />
            {form.log.output === "file" ? (
              <>
                <Field label="单文件最大 MB">
                  <Input
                    type="number"
                    min={1}
                    value={form.log.max_size}
                    onChange={(event) => patch("log", { max_size: event.target.value })}
                  />
                </Field>
                <Field label="保留旧日志个数">
                  <Input
                    type="number"
                    min={0}
                    value={form.log.max_backups}
                    onChange={(event) => patch("log", { max_backups: event.target.value })}
                  />
                </Field>
                <Field label="保留天数">
                  <Input
                    type="number"
                    min={0}
                    value={form.log.max_age}
                    onChange={(event) => patch("log", { max_age: event.target.value })}
                  />
                </Field>
              </>
            ) : null}
          </div>
        </Section>

        <Section title="订阅">
          <div className="grid gap-4">
            <SwitchField
              label="启用订阅自动刷新"
              checked={form.subscription.enabled}
              onCheckedChange={(enabled) => patch("subscription", { enabled })}
            />
            <Field label="刷新间隔">
              <Select
                value={form.subscription.interval}
                onValueChange={(interval) => patch("subscription", { interval })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5m">5m</SelectItem>
                  <SelectItem value="15m">15m</SelectItem>
                  <SelectItem value="30m">30m</SelectItem>
                  <SelectItem value="1h">1h</SelectItem>
                  <SelectItem value="6h">6h</SelectItem>
                  <SelectItem value="12h">12h</SelectItem>
                  <SelectItem value="24h">24h</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="订阅地址">
              <Textarea
                value={form.subscription.urls}
                onChange={(event) => patch("subscription", { urls: event.target.value })}
                className="min-h-28 resize-y font-mono text-xs"
              />
            </Field>
          </div>
        </Section>
      </div>
    </form>
  );
}

function NodeTable({
  nodes,
  onProbe,
  onRelease,
  onBlacklist
}: {
  nodes: NodeSnapshot[];
  onProbe: (tag: string) => void;
  onRelease: (tag: string) => void;
  onBlacklist: (tag: string) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>状态</TableHead>
          <TableHead>地域</TableHead>
          <TableHead>节点</TableHead>
          <TableHead>端口</TableHead>
          <TableHead>延迟</TableHead>
          <TableHead>连接</TableHead>
          <TableHead>失败</TableHead>
          <TableHead className="w-[170px]">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {nodes.map((node) => {
          const status = nodeStatus(node);
          const latency = node.last_latency_ms ?? -1;
          return (
            <TableRow key={node.tag}>
              <TableCell>
                <Badge variant={status.variant}>{status.label}</Badge>
              </TableCell>
              <TableCell>
                <div className="font-medium">{(node.region || "other").toUpperCase()}</div>
                <div className="font-mono text-xs text-muted-foreground">{node.exit_ip || "-"}</div>
              </TableCell>
              <TableCell>
                <div className="font-medium">{node.name || node.tag}</div>
                <div className="max-w-[280px] truncate font-mono text-xs text-muted-foreground">
                  {node.tag}
                </div>
              </TableCell>
              <TableCell className="font-mono">{node.port || "-"}</TableCell>
              <TableCell>
                <div className="flex min-w-[120px] items-center gap-2">
                  <span className="w-12 font-mono text-xs">{latency >= 0 ? `${latency}ms` : "-"}</span>
                  <QualityBar latency={latency} />
                </div>
              </TableCell>
              <TableCell className="font-mono">{node.active_connections || 0}</TableCell>
              <TableCell className={cn("font-mono", (node.failure_count || 0) > 0 && "text-destructive")}>
                {node.failure_count || 0}
              </TableCell>
              <TableCell>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => onProbe(node.tag)}>
                    探测
                  </Button>
                  {node.blacklisted ? (
                    <Button type="button" size="sm" onClick={() => onRelease(node.tag)}>
                      解封
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => onBlacklist(node.tag)}
                    >
                      拉黑
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function NodeEditorDialog({
  open,
  onOpenChange,
  editing,
  form,
  setForm,
  onSubmit
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: boolean;
  form: ConfigNode;
  setForm: React.Dispatch<React.SetStateAction<ConfigNode>>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "编辑节点" : "添加节点"}</DialogTitle>
          <DialogDescription>保存后需要重载核心生效。</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          <Field label="名称">
            <Input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="HK-01"
              required
            />
          </Field>
          <Field label="URI">
            <Textarea
              value={form.uri}
              onChange={(event) => setForm((prev) => ({ ...prev, uri: event.target.value }))}
              className="min-h-24 font-mono text-xs"
              placeholder="vless://..."
              required
            />
          </Field>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="端口">
              <Input
                type="number"
                min={0}
                max={65535}
                value={form.port || ""}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, port: Number(event.target.value) || undefined }))
                }
              />
            </Field>
            <Field label="用户名">
              <Input
                value={form.username || ""}
                onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))}
              />
            </Field>
            <Field label="密码">
              <Input
                type="password"
                value={form.password || ""}
                onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit">保存</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LoginDialog({
  open,
  password,
  error,
  setPassword,
  onSubmit
}: {
  open: boolean;
  password: string;
  error: string;
  setPassword: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-sm" onInteractOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            访问认证
          </DialogTitle>
          <DialogDescription>输入管理端密码。</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          <Field label="密码">
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
            />
          </Field>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" className="w-full">
            登录
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LoadingOverlay({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/70 backdrop-blur-sm">
      <div className="rounded-lg border bg-background px-8 py-7 text-center shadow-lg">
        <Loader2 className="mx-auto mb-4 h-9 w-9 animate-spin text-primary" />
        <div className="font-semibold">{title}</div>
        {detail ? <div className="mt-1 text-sm text-muted-foreground">{detail}</div> : null}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone = "default",
  compact = false
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "default" | "success" | "primary" | "destructive";
  compact?: boolean;
}) {
  const toneClass = {
    default: "text-foreground",
    success: "text-success",
    primary: "text-primary",
    destructive: "text-destructive"
  }[tone];

  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
        <div
          className={cn(
            "mt-2 truncate font-mono font-semibold tracking-normal",
            compact ? "text-xl" : "text-3xl",
            toneClass
          )}
        >
          {value}
        </div>
        {detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}
      </CardContent>
    </Card>
  );
}

function ChartCard({
  title,
  option,
  deps
}: {
  title: string;
  option: echarts.EChartsOption;
  deps: React.DependencyList;
}) {
  const ref = useEChart(option, deps);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div ref={ref} className="h-[260px] w-full" />
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
  className
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function SwitchField({
  label,
  checked,
  onCheckedChange
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-4 rounded-md border px-3 py-2">
      <Label className="leading-5">{label}</Label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="p-12 text-center text-sm text-muted-foreground">{label}</div>;
}

function QualityBar({ latency }: { latency: number }) {
  const width = latency < 0 ? 0 : Math.min(100, (latency / 1000) * 100);
  const color =
    latency < 0
      ? "bg-muted"
      : latency < 100
        ? "bg-success"
        : latency < 200
          ? "bg-primary"
          : latency < 500
            ? "bg-warning"
            : "bg-destructive";
  return (
    <div className="h-2 min-w-16 flex-1 overflow-hidden rounded-full bg-muted">
      <div className={cn("h-full rounded-full", color)} style={{ width: `${width}%` }} />
    </div>
  );
}

function TimelineDots({ node }: { node: NodeSnapshot }) {
  const timeline = node.timeline || [];
  if (!timeline.length) return <span className="text-muted-foreground">-</span>;
  return (
    <div className="flex max-w-[180px] flex-wrap gap-1">
      {timeline.map((event, index) => (
        <span
          key={`${event.time}-${index}`}
          title={`${event.latency_ms}ms`}
          className={cn(
            "h-2.5 w-2.5 rounded-full",
            event.success ? "bg-success" : "bg-destructive"
          )}
        />
      ))}
    </div>
  );
}

function nodeStatus(node: NodeSnapshot): {
  label: string;
  variant: "success" | "destructive" | "warning" | "muted";
} {
  const latency = node.last_latency_ms ?? -1;
  if (node.blacklisted) return { label: "拉黑", variant: "destructive" };
  if (latency < 0) return { label: "未测试", variant: "muted" };
  if ((node.failure_count || 0) >= 1) return { label: "异常", variant: "destructive" };
  return { label: "在线", variant: "success" };
}

function normalizeCoreForm(
  settings: SettingsResponse,
  subscription: SubscriptionConfig
): CoreSettingsForm {
  return {
    mode: settings.mode || "pool",
    external_ip: settings.external_ip || "",
    probe_target: settings.probe_target || "",
    skip_cert_verify: Boolean(settings.skip_cert_verify),
    listener: {
      address: settings.listener?.address || "",
      port: settings.listener?.port ? String(settings.listener.port) : "",
      username: settings.listener?.username || "",
      password: settings.listener?.password || ""
    },
    multi_port: {
      address: settings.multi_port?.address || "",
      base_port: settings.multi_port?.base_port ? String(settings.multi_port.base_port) : "",
      username: settings.multi_port?.username || "",
      password: settings.multi_port?.password || ""
    },
    pool: {
      mode: normalizePoolMode(settings.pool?.mode),
      failure_threshold: String(settings.pool?.failure_threshold || 3),
      blacklist_duration: settings.pool?.blacklist_duration || "24h"
    },
    management: {
      listen: settings.management?.listen || "",
      password: settings.management?.password || ""
    },
    log: {
      output: settings.log?.output || "stdout",
      max_size: String(settings.log?.max_size || 50),
      max_backups: String(settings.log?.max_backups || 3),
      max_age: String(settings.log?.max_age || 7),
      compress: Boolean(settings.log?.compress)
    },
    geoip: {
      enabled: Boolean(settings.geoip?.enabled),
      database_path: settings.geoip?.database_path || "",
      listen: settings.geoip?.listen || "",
      port: settings.geoip?.port ? String(settings.geoip.port) : "",
      auto_update_enabled: Boolean(settings.geoip?.auto_update_enabled),
      auto_update_interval: settings.geoip?.auto_update_interval || "24h",
      download_proxies: (settings.geoip?.download_proxies || []).join("\n")
    },
    subscription: {
      enabled: Boolean(subscription.enabled),
      interval: normalizeInterval(subscription.interval || "1h"),
      urls: (subscription.subscriptions || []).join("\n")
    }
  };
}

function buildCorePayload(form: CoreSettingsForm) {
  return {
    external_ip: form.external_ip,
    probe_target: form.probe_target,
    skip_cert_verify: form.skip_cert_verify,
    mode: form.mode,
    listener: {
      address: form.listener.address,
      port: Number(form.listener.port) || 0,
      username: form.listener.username,
      password: form.listener.password
    },
    multi_port: {
      address: form.multi_port.address,
      base_port: Number(form.multi_port.base_port) || 0,
      username: form.multi_port.username,
      password: form.multi_port.password
    },
    pool: {
      mode: normalizePoolMode(form.pool.mode),
      failure_threshold: Number(form.pool.failure_threshold) || 3,
      blacklist_duration: form.pool.blacklist_duration || "24h"
    },
    management: {
      listen: form.management.listen,
      password: form.management.password
    },
    log: {
      output: form.log.output,
      max_size: Number(form.log.max_size) || 50,
      max_backups: Number(form.log.max_backups) || 3,
      max_age: Number(form.log.max_age) || 7,
      compress: form.log.compress
    },
    geoip: {
      enabled: form.geoip.enabled,
      database_path: form.geoip.database_path,
      listen: form.geoip.listen,
      port: Number(form.geoip.port) || 0,
      auto_update_enabled: form.geoip.auto_update_enabled,
      auto_update_interval: form.geoip.auto_update_interval || "24h",
      download_proxies: splitLines(form.geoip.download_proxies)
    }
  };
}

function buildSubscriptionPayload(form: CoreSettingsForm) {
  return {
    subscriptions: splitLines(form.subscription.urls),
    enabled: form.subscription.enabled,
    interval: form.subscription.interval || "1h"
  };
}

function coreFormSnapshot(form: CoreSettingsForm) {
  const { subscription: _subscription, ...core } = form;
  return JSON.stringify(core);
}

function subscriptionSnapshot(form: CoreSettingsForm) {
  return JSON.stringify(buildSubscriptionPayload(form));
}

function normalizePoolMode(mode?: string) {
  switch ((mode || "").trim().toLowerCase()) {
    case "random":
      return "random";
    case "balance":
      return "balance";
    case "latency":
      return "latency";
    case "sequential":
    default:
      return "sequential";
  }
}

function normalizeUpdateForm(update: UpdateConfig): Required<UpdateConfig> {
  return {
    enabled: Boolean(update.enabled),
    channel: update.channel || "stable",
    check_interval: update.check_interval || "1h",
    proxy_base_url: update.proxy_base_url || DEFAULT_UPDATE_FORM.proxy_base_url,
    repo: update.repo || DEFAULT_UPDATE_FORM.repo
  };
}

function splitLines(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeInterval(interval: string) {
  if (!interval) return "1h";
  const options = ["5m", "15m", "30m", "1h", "6h", "12h", "24h"];
  return options.find((option) => interval === option || interval.startsWith(option)) || "1h";
}

function formatBytes(bytes: number, decimals = 2) {
  if (!bytes || Number.isNaN(bytes) || bytes <= 0) return "0 B";
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${Number.parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

function readThemeMode(): ThemeMode {
  const mode = localStorage.getItem("themeMode") || localStorage.getItem("theme") || "auto";
  return mode === "dark" || mode === "light" || mode === "auto" ? mode : "auto";
}

function applyThemeMode(mode: ThemeMode) {
  const root = document.documentElement;
  const osDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const visual = mode === "auto" ? (osDark ? "dark" : "light") : mode;
  root.classList.toggle("dark", visual === "dark");
}

function chartPalette(mode?: ThemeMode) {
  const isDark =
    mode === "dark" ||
    (mode === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches) ||
    (!mode && document.documentElement.classList.contains("dark"));
  return {
    background: isDark ? "#09090b" : "#ffffff",
    foreground: isDark ? "#fafafa" : "#09090b",
    muted: isDark ? "#a1a1aa" : "#71717a",
    border: isDark ? "#27272a" : "#e4e4e7",
    primary: isDark ? "#fafafa" : "#18181b",
    success: "#16a34a",
    warning: "#f59e0b",
    destructive: "#dc2626"
  };
}

function chartTooltip(mode?: ThemeMode, trigger: "item" | "axis" = "item") {
  const palette = chartPalette(mode);
  return {
    trigger,
    backgroundColor: palette.background,
    borderColor: palette.border,
    textStyle: { color: palette.foreground }
  };
}

export default App;
