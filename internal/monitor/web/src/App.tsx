import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { flushSync } from "react-dom";
import * as echarts from "echarts";
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable
} from "@tanstack/react-table";
import {
  Activity,
  ArrowUpDown,
  BarChart3,
  Bug,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  Clock3,
  Copy,
  Download,
  FileText,
  Gauge,
  Github,
  Globe2,
  LayoutDashboard,
  Link2,
  Loader2,
  Lock,
  MoreHorizontal,
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
import { ChartContainer } from "@/components/ui/chart";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Field as FieldRoot,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
import {
  Sidebar as AppSidebarPrimitive,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { useEChart } from "@/hooks/use-echart";
import { cn } from "@/lib/utils";
import type {
  AddressEntry,
  AddressesResponse,
  AddressProtocol,
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
  VersionResponse,
  WarpRegisterForm,
  WarpRegisterResponse
} from "@/types";

const NAV_ITEMS: Array<{ id: TabId; label: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "总览", icon: LayoutDashboard },
  { id: "manage", label: "节点", icon: Network },
  { id: "debug", label: "诊断", icon: Bug },
  { id: "logs", label: "日志", icon: Terminal },
  { id: "ota", label: "更新", icon: UploadCloud },
  { id: "settings", label: "设置", icon: Settings }
];

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => void;
};

type RegionSeed = {
  value: string;
  label: string;
  flag: string;
  fallback: string;
};

type RegionVisual = RegionSeed & {
  color: string;
  surface: string;
  border: string;
  text: string;
};

type RegionVisuals = Record<string, RegionVisual>;

const REGION_OPTIONS = [
  { value: "all", label: "ALL", flag: "🌐", fallback: "#018eee" },
  { value: "jp", label: "JP", flag: "🇯🇵", fallback: "#c91f45" },
  { value: "kr", label: "KR", flag: "🇰🇷", fallback: "#2855a6" },
  { value: "us", label: "US", flag: "🇺🇸", fallback: "#3a5796" },
  { value: "hk", label: "HK", flag: "🇭🇰", fallback: "#d72f2f" },
  { value: "tw", label: "TW", flag: "🇹🇼", fallback: "#24488f" },
  { value: "sg", label: "SG", flag: "🇸🇬", fallback: "#d91f36" },
  { value: "other", label: "OTHER", flag: "◌", fallback: "#64748b" }
] satisfies RegionSeed[];

const REGION_SEEDS = REGION_OPTIONS.reduce<Record<string, RegionSeed>>((acc, region) => {
  acc[region.value] = region;
  return acc;
}, {});

const REGION_FALLBACK_COLORS = REGION_OPTIONS.reduce<Record<string, string>>((acc, region) => {
  acc[region.value] = region.fallback;
  return acc;
}, {});

const POOL_MODE_OPTIONS = [
  { value: "sequential", label: "sequential" },
  { value: "random", label: "random" },
  { value: "balance", label: "balance" },
  { value: "latency", label: "latency" }
];

const EXIT_IP_PROBE_MODE_OPTIONS = [
  { value: "interval", label: "按间隔" },
  { value: "subscription_refresh", label: "跟随订阅刷新" }
];

const EMPTY_PROBE_PROGRESS: ProbeProgress = {
  visible: false,
  total: 0,
  current: 0,
  success: 0,
  failed: 0,
  percent: 0
};

const DEFAULT_WARP_ENDPOINT = "engage.cloudflareclient.com";
const DEFAULT_WARP_PORT = 2408;

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
    password: "",
    health_check_interval: "5m",
    health_check_concurrency: "",
    initial_check_concurrency: ""
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
    exit_ip_probe_mode: "interval",
    exit_ip_probe_interval: "5m",
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
  repo: "lieyanc/easy-proxies",
  use_fastest_node: false
};

const OTA_ACTIVE_STATES = new Set(["checking", "downloading", "applying"]);

const OTA_STATE_LABELS: Record<string, string> = {
  disabled: "未启用",
  idle: "空闲",
  checking: "检查中",
  downloading: "下载中",
  ready: "待应用",
  applying: "应用中",
  failed: "失败"
};

type DataTableColumnMeta = {
  label?: string;
};

function isOtaActiveState(state?: string) {
  return Boolean(state && OTA_ACTIVE_STATES.has(state));
}

function otaStateLabel(state: string) {
  return OTA_STATE_LABELS[state] || state;
}

function clampPercent(value?: number) {
  return Math.max(0, Math.min(100, value || 0));
}

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
  const [addressesOpen, setAddressesOpen] = useState(false);
  const [addressesData, setAddressesData] = useState<AddressesResponse | null>(null);
  const [addressesLoading, setAddressesLoading] = useState(false);
  const [addressProtocol, setAddressProtocol] = useState<AddressProtocol>("http");
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
  const [warpDialogOpen, setWarpDialogOpen] = useState(false);
  const [warpRegistering, setWarpRegistering] = useState(false);
  const [warpForm, setWarpForm] = useState<WarpRegisterForm>({
    name: "WARP-01",
    endpoint: DEFAULT_WARP_ENDPOINT,
    endpoint_port: DEFAULT_WARP_PORT
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

  const changeTab = useCallback(
    (tab: TabId) => {
      if (tab === activeTab) return;

      const applyTab = () => setActiveTab(tab);
      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const startViewTransition = (document as ViewTransitionDocument).startViewTransition;

      if (prefersReducedMotion || typeof startViewTransition !== "function") {
        applyTab();
        return;
      }

      startViewTransition.call(document, () => {
        flushSync(applyTab);
      });
    },
    [activeTab]
  );

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

  const loadDebugData = useCallback(
    async (silent = false) => {
      try {
        const payload = await apiJson<DebugResponse>("/api/debug");
        setDebugData({
          nodes: payload.nodes || [],
          total_calls: payload.total_calls || 0,
          total_success: payload.total_success || 0,
          success_rate: payload.success_rate || 0
        });
      } catch (error) {
        if (silent) {
          if (error instanceof UnauthorizedError) {
            setAuthenticated(false);
            setLoginOpen(true);
          }
          return;
        }
        handleApiError(error, "诊断数据读取失败");
      }
    },
    [handleApiError]
  );

  const loadAddresses = useCallback(async () => {
    setAddressesLoading(true);
    try {
      const payload = await apiJson<AddressesResponse>("/api/addresses");
      setAddressesData({ ...payload, entries: payload.entries || [] });
      setAuthenticated(true);
      setLoginOpen(false);
    } catch (error) {
      handleApiError(error, "连接地址读取失败");
    } finally {
      setAddressesLoading(false);
    }
  }, [handleApiError]);

  function openAddressesDialog() {
    setAddressesOpen(true);
    void loadAddresses();
  }

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

  function openWarpDialog() {
    const existingNames = new Set(configNodes.map((node) => node.name));
    let index = 1;
    while (existingNames.has(`WARP-${String(index).padStart(2, "0")}`)) index += 1;
    setWarpForm({
      name: `WARP-${String(index).padStart(2, "0")}`,
      endpoint: DEFAULT_WARP_ENDPOINT,
      endpoint_port: DEFAULT_WARP_PORT
    });
    setWarpDialogOpen(true);
  }

  async function handleWarpRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload: WarpRegisterForm = {
      name: warpForm.name.trim(),
      endpoint: warpForm.endpoint.trim(),
      endpoint_port: Number(warpForm.endpoint_port)
    };

    setWarpRegistering(true);
    try {
      const response = await apiJson<WarpRegisterResponse>(
        "/api/warp/register",
        jsonRequest("POST", payload)
      );
      setWarpDialogOpen(false);
      await loadConfigNodes();
      toast.success(response.message || "WARP 已注册并生效");
    } catch (error) {
      handleApiError(error, "WARP 注册失败");
    } finally {
      setWarpRegistering(false);
    }
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

  const loadUpdateStatus = useCallback(async () => {
    try {
      const [version, status] = await Promise.all([
        apiJson<VersionResponse>("/api/version"),
        apiJson<UpdateStatusResponse>("/api/update/status")
      ]);
      setCurrentVersion(version.version?.version || status.status?.current_version || "dev");
      setUpdateStatus(status);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        setAuthenticated(false);
        setLoginOpen(true);
      }
    }
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    void loadUpdateStatus();
  }, [authenticated, loadUpdateStatus]);

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

  useEffect(() => {
    if (!authenticated) return;

    const state = updateStatus?.status?.state;
    const isRunning = isOtaActiveState(state);
    if (activeTab !== "ota" && !isRunning) return;

    const intervalMs = isRunning ? 1000 : 5000;
    const id = window.setInterval(() => {
      if (document.hidden && !isRunning) return;
      void loadUpdateStatus();
    }, intervalMs);

    return () => window.clearInterval(id);
  }, [activeTab, authenticated, loadUpdateStatus, updateStatus?.status?.state]);

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
            repo: updateForm.repo,
            use_fastest_node: updateForm.use_fastest_node
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
    <TooltipProvider delayDuration={200}>
      <div className="app-frame h-screen overflow-hidden text-foreground">
        <SidebarProvider>
          <Sidebar
            activeTab={activeTab}
            onChange={changeTab}
            stars={githubStars}
            currentVersion={currentVersion}
          />
          <SidebarInset className="overflow-hidden">
            <Header
              activeTab={activeTab}
              onTabChange={changeTab}
              lastUpdate={lastUpdate}
              themeMode={themeMode}
              onThemeToggle={cycleTheme}
              autoRefresh={autoRefresh}
              onAutoRefreshToggle={() => setAutoRefresh((value) => !value)}
              onProbeAll={probeAllNodes}
              onAddresses={openAddressesDialog}
              onExport={exportNodes}
              onRefresh={() => void refreshNodes(false)}
              onRefreshSubscription={refreshSubscription}
              subscriptionEnabled={Boolean(subscriptionStatus?.enabled)}
              isProbing={isProbing}
            />
            {probeProgress.visible ? <ProbeProgressBar progress={probeProgress} /> : null}
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6 xl:p-7">
              <div key={activeTab} className="tab-panel">
                {activeTab === "dashboard" ? (
                  <DashboardView
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
                    onRegisterWarp={openWarpDialog}
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
            </div>
          </SidebarInset>
        </SidebarProvider>
        <LoginDialog
          open={loginOpen}
          password={loginPassword}
          error={loginError}
          setPassword={setLoginPassword}
          onSubmit={handleLogin}
        />
        <ConnectionAddressesDialog
          open={addressesOpen}
          onOpenChange={setAddressesOpen}
          data={addressesData}
          loading={addressesLoading}
          protocol={addressProtocol}
          onProtocolChange={setAddressProtocol}
          onReload={loadAddresses}
        />
        <NodeEditorDialog
          open={nodeDialogOpen}
          onOpenChange={setNodeDialogOpen}
          editing={Boolean(editingNodeName)}
          form={nodeForm}
          setForm={setNodeForm}
          onSubmit={handleNodeSubmit}
        />
        <WarpRegisterDialog
          open={warpDialogOpen}
          onOpenChange={setWarpDialogOpen}
          form={warpForm}
          setForm={setWarpForm}
          registering={warpRegistering}
          onSubmit={handleWarpRegister}
        />
        {loadingOverlay ? (
          <LoadingOverlay title={loadingOverlay.title} detail={loadingOverlay.detail} />
        ) : null}
      </div>
    </TooltipProvider>
  );
}

function Sidebar({
  activeTab,
  onChange,
  stars,
  currentVersion
}: {
  activeTab: TabId;
  onChange: (tab: TabId) => void;
  stars: string;
  currentVersion: string;
}) {
  return (
    <AppSidebarPrimitive>
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
          <Globe2 className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-sidebar-foreground">EasyProxies</div>
          <div className="mt-0.5 flex items-center gap-1 text-xs text-sidebar-foreground/60">
            <Github className="h-3 w-3" />
            <span>Modified By lieyanc</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarMenu>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton type="button" isActive={active} onClick={() => onChange(item.id)}>
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="grid gap-2">
          <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-sidebar-border bg-sidebar px-3 py-2 text-xs">
            <span className="shrink-0 text-sidebar-foreground/60">Version</span>
            <span className="min-w-0 truncate rounded-sm bg-sidebar-primary/10 px-2 py-0.5 font-mono font-semibold text-sidebar-primary">
              {currentVersion}
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent px-3 py-2 text-xs text-sidebar-foreground/60">
            <Github className="h-3.5 w-3.5 shrink-0 text-sidebar-primary" />
            <span className="min-w-0 truncate font-medium text-sidebar-foreground">{stars}</span>
            <span className="shrink-0">Stars</span>
          </div>
        </div>
      </SidebarFooter>
    </AppSidebarPrimitive>
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
  onAddresses,
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
  onAddresses: () => void;
  onExport: () => void;
  onRefresh: () => void;
  onRefreshSubscription: () => void;
  subscriptionEnabled: boolean;
  isProbing: boolean;
}) {
  const ThemeIcon = themeMode === "dark" ? Moon : themeMode === "light" ? Sun : Circle;

  return (
    <header className="flex min-h-16 shrink-0 flex-col gap-3 border-b bg-background px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-6">
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
        <Badge variant="secondary" className="gap-2">
          <span className="h-2 w-2 rounded-full bg-success" />
          {lastUpdate}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="icon" variant="outline" onClick={onThemeToggle} title="切换主题">
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
        <Button type="button" variant="outline" onClick={onAddresses}>
          <Link2 className="h-4 w-4" />
          连接地址
        </Button>
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

function ConnectionAddressesDialog({
  open,
  onOpenChange,
  data,
  loading,
  protocol,
  onProtocolChange,
  onReload
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: AddressesResponse | null;
  loading: boolean;
  protocol: AddressProtocol;
  onProtocolChange: (protocol: AddressProtocol) => void;
  onReload: () => void;
}) {
  const entries = data?.entries || [];
  const protocolEntries = useMemo(
    () => entries.filter((entry) => entry.protocol === protocol),
    [entries, protocol]
  );
  const poolEntries = protocolEntries.filter((entry) => entry.kind === "pool");
  const geoIPEntries = protocolEntries.filter((entry) => entry.kind === "geoip");
  const multiPortEntries = protocolEntries.filter((entry) => entry.kind === "multi-port");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-3xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4">
          <div className="flex flex-col gap-3 pr-8 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2">
                <Link2 className="h-4 w-4" />
                连接地址
              </DialogTitle>
              <DialogDescription className="mt-2 flex items-center gap-2">
                <span>运行模式</span>
                <Badge variant="secondary">{data?.mode || "-"}</Badge>
              </DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="flex h-9 rounded-md border bg-muted p-0.5">
                {(["http", "socks5"] as AddressProtocol[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={cn(
                      "h-8 rounded-sm px-3 text-xs font-medium transition-colors",
                      protocol === item
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => onProtocolChange(item)}
                  >
                    {item.toUpperCase()}
                  </button>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={onReload}
                disabled={loading}
                title="刷新地址"
              >
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              </Button>
            </div>
          </div>
        </DialogHeader>
        <div className="scrollbar-thin min-h-0 overflow-y-auto px-5 py-4">
          {loading ? (
            <AddressLoadingState />
          ) : entries.length ? (
            <div className="space-y-4">
              <AddressGroup title="单端口入口" entries={poolEntries} />
              <AddressGroup title="GeoIP 地域路由" entries={geoIPEntries} />
              <AddressGroup
                title="独立端口节点"
                entries={multiPortEntries}
                collapsible
                defaultOpen={multiPortEntries.length > 0 && multiPortEntries.length <= 4}
              />
              {!protocolEntries.length ? <EmptyState label="当前协议暂无地址" /> : null}
            </div>
          ) : (
            <EmptyState label="暂无连接地址" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddressGroup({
  title,
  entries,
  collapsible = false,
  defaultOpen = true
}: {
  title: string;
  entries: AddressEntry[];
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen, entries.length]);

  if (!entries.length) return null;

  const header = (
    <div className="flex min-w-0 items-center gap-2">
      {collapsible ? (
        open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )
      ) : null}
      <span className="min-w-0 truncate text-sm font-semibold">{title}</span>
      <Badge variant="secondary" className="shrink-0">
        {entries.length}
      </Badge>
    </div>
  );

  return (
    <section className="overflow-hidden rounded-md border bg-background">
      {collapsible ? (
        <button
          type="button"
          className="flex h-11 w-full items-center justify-between px-3 text-left hover:bg-muted/50"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          {header}
        </button>
      ) : (
        <div className="flex h-11 items-center px-3">{header}</div>
      )}
      {open ? (
        <div className="space-y-2 border-t bg-muted/20 p-3">
          {entries.map((entry) => (
            <AddressRow key={entry.id} entry={entry} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AddressRow({ entry }: { entry: AddressEntry }) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-md border bg-background p-3">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium">{entry.label}</span>
          {entry.description ? (
            <Badge variant="secondary" className="shrink-0">
              {entry.description}
            </Badge>
          ) : null}
          {entry.port ? (
            <span className="shrink-0 font-mono text-xs text-muted-foreground">:{entry.port}</span>
          ) : null}
        </div>
        <div className="mt-2 break-all rounded-sm bg-muted px-2 py-1.5 font-mono text-xs text-muted-foreground">
          {entry.url}
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={() => void copyAddress(entry.url)}
        title="复制"
      >
        <Copy className="h-4 w-4" />
      </Button>
    </div>
  );
}

function AddressLoadingState() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-20 animate-pulse rounded-md border bg-muted/50" />
      ))}
    </div>
  );
}

async function copyAddress(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else if (!fallbackCopy(value)) {
      throw new Error("clipboard unavailable");
    }
    toast.success("已复制");
  } catch {
    toast.error("复制失败");
  }
}

function fallbackCopy(value: string) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } finally {
    textarea.remove();
  }
  return ok;
}

function DashboardView({
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
  const regionVisuals = useFlagRegionVisuals(themeMode);
  const regionOption = useMemo(() => {
    const pieNodes = allNodes.filter(canCountInRegionPie);
    const keys = Array.from(new Set(pieNodes.map((node) => node.region || "other")));

    const data = sortRegionKeys(keys).map((key) => {
      const regionNodes = pieNodes.filter((node) => (node.region || "other") === key);
      const total = regionNodes.length;
      const ok = regionNodes.filter(
        (node) => node.initial_check_done && node.available
      ).length;
      const visual = regionVisual(regionVisuals, key);
      return {
        name: key.toUpperCase(),
        value: total,
        itemStyle: {
          color: visual.color,
          opacity: ok === 0 ? 0.46 : ok < total ? 0.74 : 1
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
  }, [allNodes, regionVisuals, themeMode]);

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
              { offset: 0, color: "rgba(1, 142, 238, 0.28)" },
              { offset: 1, color: "rgba(1, 142, 238, 0)" }
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

  const requestSummary = useMemo(() => {
    const totalSuccess = allNodes.reduce((sum, node) => sum + (node.success_count || 0), 0);
    const totalFailure = allNodes.reduce((sum, node) => sum + (node.failure_count || 0), 0);
    const totalCalls = totalSuccess + totalFailure;
    const topNodes = [...allNodes]
      .map((node) => {
        const success = node.success_count || 0;
        const failure = node.failure_count || 0;
        return {
          node,
          calls: success + failure
        };
      })
      .filter((item) => item.calls > 0)
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 3);

    return {
      totalCalls,
      totalSuccess,
      totalFailure,
      successRate: totalCalls ? (totalSuccess / totalCalls) * 100 : 0,
      topNodes
    };
  }, [allNodes]);

  return (
    <div className="space-y-6">
      <div className="grid items-stretch gap-4 lg:grid-cols-3">
        <NodeOverviewCard stats={stats} subscriptionStatus={subscriptionStatus} />
        <RequestOverviewCard
          totalCalls={requestSummary.totalCalls}
          totalSuccess={requestSummary.totalSuccess}
          totalFailure={requestSummary.totalFailure}
          successRate={requestSummary.successRate}
          topNodes={requestSummary.topNodes}
        />
        <SpeedOverviewCard up={stats.up} down={stats.down} active={stats.active} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard title="地域分布" option={regionOption} deps={[regionOption]} />
        <ChartCard title="最低延迟" option={latencyOption} deps={[latencyOption]} />
        <ChartCard title="实时流量" option={trafficOption} deps={[trafficOption]} />
      </div>

      <div className="flex flex-wrap gap-2">
        {REGION_OPTIONS.map((region) => {
          const selected = currentRegion === region.value;
          const visual = regionVisual(regionVisuals, region.value);
          return (
            <Button
              key={region.value}
              type="button"
              size="sm"
              variant={selected ? "default" : "outline"}
              className="gap-1.5"
              onClick={() => onRegionChange(region.value)}
            >
              <span className="text-sm leading-none">{visual.flag}</span>
              {region.label}
            </Button>
          );
        })}
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="flex flex-col gap-3 border-b md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>节点状态</CardTitle>
            <CardDescription>当前筛选 {nodes.length} 个节点</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {nodes.length ? (
            <NodeTable
              nodes={nodes}
              regionVisuals={regionVisuals}
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

type TopRequestNode = {
  node: NodeSnapshot;
  calls: number;
};

function DashboardSummaryCard({
  title,
  icon: Icon,
  children
}: {
  title: string;
  icon: typeof LayoutDashboard;
  children: ReactNode;
}) {
  return (
    <Card className="flex h-full min-h-[350px] flex-col overflow-hidden">
      <CardHeader className="flex flex-row items-center gap-3 border-b px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Icon className="h-4 w-4" />
        </div>
        <CardTitle className="text-sm font-semibold tracking-normal">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col justify-between gap-4 p-4">
        {children}
      </CardContent>
    </Card>
  );
}

function DashboardMiniStat({
  label,
  value,
  tone = "default"
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "success" | "primary" | "destructive";
}) {
  const toneClass = {
    default: "text-foreground",
    success: "text-success",
    primary: "text-primary",
    destructive: "text-destructive"
  }[tone];

  return (
    <div className="min-w-0 rounded-md border bg-muted/35 px-3 py-2">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 truncate font-mono text-sm font-semibold", toneClass)}>{value}</div>
    </div>
  );
}

function NodeOverviewCard({
  stats,
  subscriptionStatus
}: {
  stats: {
    total: number;
    healthy: number;
    blocked: number;
  };
  subscriptionStatus: SubscriptionStatus | null;
}) {
  const healthRate = stats.total ? (stats.healthy / stats.total) * 100 : 0;
  const pending = Math.max(stats.total - stats.healthy - stats.blocked, 0);

  return (
    <DashboardSummaryCard title="节点" icon={Network}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">可用 / 总数</div>
          <div className="mt-1 flex items-baseline gap-1 font-mono">
            <span className="text-3xl font-semibold text-success">{formatCount(stats.healthy)}</span>
            <span className="text-lg text-muted-foreground">/</span>
            <span className="text-xl font-semibold text-foreground">{formatCount(stats.total)}</span>
          </div>
        </div>
        {subscriptionStatus?.enabled ? (
          <Badge variant="secondary" className="shrink-0">
            Sub {subscriptionStatus.node_count ?? 0}
          </Badge>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>健康率</span>
          <span className="font-mono text-foreground">{healthRate.toFixed(1)}%</span>
        </div>
        <Progress value={healthRate} className="h-2" />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <DashboardMiniStat label="健康节点" value={formatCount(stats.healthy)} tone="success" />
        <DashboardMiniStat label="不可用" value={formatCount(stats.blocked)} tone="destructive" />
        <DashboardMiniStat label="待检测" value={formatCount(pending)} />
      </div>
    </DashboardSummaryCard>
  );
}

function RequestOverviewCard({
  totalCalls,
  totalSuccess,
  totalFailure,
  successRate,
  topNodes
}: {
  totalCalls: number;
  totalSuccess: number;
  totalFailure: number;
  successRate: number;
  topNodes: TopRequestNode[];
}) {
  const topMax = Math.max(...topNodes.map((item) => item.calls), 0);

  return (
    <DashboardSummaryCard title="请求次数" icon={BarChart3}>
      <div>
        <div className="text-xs text-muted-foreground">总请求</div>
        <div className="mt-1 font-mono text-3xl font-semibold text-foreground">
          {formatCount(totalCalls)}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <DashboardMiniStat label="成功" value={formatCount(totalSuccess)} tone="success" />
        <DashboardMiniStat label="失败" value={formatCount(totalFailure)} tone="destructive" />
        <DashboardMiniStat label="成功率" value={`${successRate.toFixed(1)}%`} tone="primary" />
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Activity className="h-3.5 w-3.5" />
          Top 节点
        </div>
        {topNodes.length ? (
          <div className="space-y-2">
            {topNodes.map((item, index) => {
              const name = item.node.name || item.node.tag;
              const percent = topMax ? (item.calls / topMax) * 100 : 0;
              return (
                <div key={item.node.tag} className="space-y-1.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge variant="secondary" className="h-6 w-8 shrink-0 justify-center px-0">
                      {index + 1}
                    </Badge>
                    <div className="min-w-0 flex-1 truncate text-sm font-medium">{name}</div>
                    <div className="shrink-0 font-mono text-sm font-semibold">
                      {formatCount(item.calls)}
                    </div>
                  </div>
                  <Progress value={percent} className="h-1.5" />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-md border border-dashed py-5 text-center text-sm text-muted-foreground">
            暂无请求数据
          </div>
        )}
      </div>
    </DashboardSummaryCard>
  );
}

function SpeedOverviewCard({ up, down, active }: { up: number; down: number; active: number }) {
  const total = up + down;
  const downShare = total > 0 ? (down / total) * 100 : 0;
  const upShare = total > 0 ? (up / total) * 100 : 0;

  return (
    <DashboardSummaryCard title="实时指标" icon={Gauge}>
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0 rounded-md border bg-muted/35 px-3 py-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Gauge className="h-3.5 w-3.5" />
            总吞吐
          </div>
          <div className="mt-2 truncate font-mono text-2xl font-semibold text-success">
            {formatBytes(total)}/s
          </div>
        </div>
        <div className="min-w-0 rounded-md border bg-muted/35 px-3 py-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Activity className="h-3.5 w-3.5" />
            活跃连接
          </div>
          <div className="mt-2 truncate font-mono text-2xl font-semibold text-primary">
            {formatCount(active)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <DashboardMiniStat label="下载速率" value={`${formatBytes(down)}/s`} tone="success" />
        <DashboardMiniStat label="上传速率" value={`${formatBytes(up)}/s`} tone="primary" />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>流量方向</span>
          <span className="font-mono text-foreground">Down / Up</span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-success" style={{ width: `${downShare}%` }} />
          <div className="h-full bg-primary" style={{ width: `${upShare}%` }} />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Down {downShare.toFixed(0)}%</span>
          <span>Up {upShare.toFixed(0)}%</span>
        </div>
      </div>
    </DashboardSummaryCard>
  );
}

function ManageView({
  nodes,
  onAdd,
  onRegisterWarp,
  onEdit,
  onDelete,
  onReload
}: {
  nodes: ConfigNode[];
  onAdd: () => void;
  onRegisterWarp: () => void;
  onEdit: (node: ConfigNode) => void;
  onDelete: (name: string) => void;
  onReload: () => void;
}) {
  const hasSubscriptionNodes = nodes.some((node) => node.source === "subscription");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-normal">节点管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">{nodes.length} 个配置节点</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onRegisterWarp}>
            <Globe2 className="h-4 w-4" />
            注册 WARP
          </Button>
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

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {nodes.length ? (
            <ConfigNodesDataTable nodes={nodes} onEdit={onEdit} onDelete={onDelete} />
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
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="调用总数" value={data.total_calls || 0} />
        <MetricCard label="成功调用" value={data.total_success || 0} tone="success" />
        <MetricCard label="成功率" value={`${(data.success_rate || 0).toFixed(1)}%`} tone="primary" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="全局成功率" option={successOption} deps={[successOption]} />
        <ChartCard title="失败排行" option={failureOption} deps={[failureOption]} />
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="border-b">
          <CardTitle>节点诊断</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.nodes.length ? (
            <DebugNodesDataTable nodes={data.nodes} />
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
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-col gap-3 border-b md:flex-row md:items-center md:justify-between">
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
      <CardContent className="pt-5">
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
  const stateLabel = otaStateLabel(state);
  const progress = clampPercent(status?.status?.progress);
  const downloadProgress = clampPercent(status?.status?.download_progress);
  const isRunning = isOtaActiveState(state);
  const progressLabel = `${Math.round(progress)}%`;
  const statusMessage =
    status?.message ||
    status?.status?.error ||
    status?.status?.release_notes ||
    (status?.status?.last_check ? `上次检查: ${status.status.last_check}` : "");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-normal">OTA 更新</h1>
          <p className="mt-1 text-sm text-muted-foreground">{stateLabel}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onCheck} disabled={isRunning}>
            <RefreshCw className={cn("h-4 w-4", isRunning ? "animate-spin" : "")} />
            检查更新
          </Button>
          <Button type="button" onClick={onApply} disabled={isRunning}>
            {isRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UploadCloud className="h-4 w-4" />
            )}
            下载/应用
          </Button>
          <Button type="button" variant="outline" onClick={onDismiss} disabled={state !== "ready"}>
            忽略
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="当前版本" value={currentVersion} compact />
        <MetricCard label="最新版本" value={status?.status?.latest_version || "-"} compact />
        <MetricCard label="更新状态" value={stateLabel} compact />
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="border-b">
          <CardTitle>更新配置</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-5 pt-5" onSubmit={onSubmit}>
            <SwitchField
              label="启用后台更新检查"
              checked={form.enabled}
              onCheckedChange={(enabled) => setForm((prev) => ({ ...prev, enabled }))}
            />
            <SwitchField
              label="下载走最快节点"
              checked={form.use_fastest_node}
              onCheckedChange={(use_fastest_node) =>
                setForm((prev) => ({ ...prev, use_fastest_node }))
              }
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
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>整体 {progressLabel}</span>
                {state === "downloading" ? <span>下载 {Math.round(downloadProgress)}%</span> : null}
              </div>
              <p className="line-clamp-3 text-xs text-muted-foreground">
                {statusMessage}
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
    <form className="space-y-6" onSubmit={onSubmit}>
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
            <Field label="健康检查间隔">
              <Input
                value={form.management.health_check_interval}
                onChange={(event) => patch("management", { health_check_interval: event.target.value })}
                placeholder="5m"
              />
            </Field>
            <Field label="后台探测并发">
              <Input
                type="number"
                min={1}
                value={form.management.health_check_concurrency}
                onChange={(event) => patch("management", { health_check_concurrency: event.target.value })}
                placeholder="CPU 核心数"
              />
            </Field>
            <Field label="启动初检并发">
              <Input
                type="number"
                min={1}
                value={form.management.initial_check_concurrency}
                onChange={(event) => patch("management", { initial_check_concurrency: event.target.value })}
                placeholder="20"
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
            <Field label="更新间隔">
              <Input
                value={form.geoip.auto_update_interval}
                onChange={(event) => patch("geoip", { auto_update_interval: event.target.value })}
              />
            </Field>
            <Field label="出口 IP 探测">
              <Select
                value={form.geoip.exit_ip_probe_mode}
                onValueChange={(exit_ip_probe_mode) => patch("geoip", { exit_ip_probe_mode })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXIT_IP_PROBE_MODE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {form.geoip.exit_ip_probe_mode === "interval" ? (
              <Field label="出口探测间隔">
                <Input
                  value={form.geoip.exit_ip_probe_interval}
                  onChange={(event) => patch("geoip", { exit_ip_probe_interval: event.target.value })}
                  placeholder="5m"
                />
              </Field>
            ) : null}
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

function ConfigNodesDataTable({
  nodes,
  onEdit,
  onDelete
}: {
  nodes: ConfigNode[];
  onEdit: (node: ConfigNode) => void;
  onDelete: (name: string) => void;
}) {
  const columns = useMemo<Array<ColumnDef<ConfigNode, unknown>>>(
    () => [
      {
        accessorKey: "name",
        meta: { label: "名称" } satisfies DataTableColumnMeta,
        header: ({ column }) => <SortableHeader column={column} label="名称" />,
        cell: ({ row }) => <div className="font-medium">{row.original.name}</div>
      },
      {
        accessorKey: "uri",
        meta: { label: "URI" } satisfies DataTableColumnMeta,
        header: "URI",
        cell: ({ row }) => (
          <div className="max-w-[460px] truncate font-mono text-xs text-muted-foreground">
            {row.original.uri}
          </div>
        )
      },
      {
        accessorKey: "port",
        meta: { label: "端口" } satisfies DataTableColumnMeta,
        header: ({ column }) => <SortableHeader column={column} label="端口" />,
        cell: ({ row }) => <span className="font-mono">{row.original.port || "-"}</span>
      },
      {
        accessorKey: "source",
        meta: { label: "来源" } satisfies DataTableColumnMeta,
        header: "来源",
        cell: ({ row }) => (
          <Badge variant={row.original.source === "subscription" ? "warning" : "success"}>
            {row.original.source || "manual"}
          </Badge>
        )
      },
      {
        id: "actions",
        enableHiding: false,
        cell: ({ row }) => (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8">
                    <MoreHorizontal className="h-4 w-4" />
                    <span className="sr-only">打开菜单</span>
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>操作</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>操作</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => onEdit(row.original)}>
                <Wrench className="h-4 w-4" />
                编辑
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onDelete(row.original.name)}
              >
                <Trash2 className="h-4 w-4" />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      }
    ],
    [onDelete, onEdit]
  );

  return (
    <DataTable
      columns={columns}
      data={nodes}
      filterColumn="name"
      filterPlaceholder="筛选节点..."
      emptyLabel="暂无节点"
    />
  );
}

function DebugNodesDataTable({ nodes }: { nodes: NodeSnapshot[] }) {
  const columns = useMemo<Array<ColumnDef<NodeSnapshot, unknown>>>(
    () => [
      {
        id: "name",
        accessorFn: (node) => `${node.name || ""} ${node.tag || ""}`,
        meta: { label: "节点" } satisfies DataTableColumnMeta,
        header: ({ column }) => <SortableHeader column={column} label="节点" />,
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.name || row.original.tag}</div>
            <div className="font-mono text-xs text-muted-foreground">{row.original.tag}</div>
          </div>
        )
      },
      {
        id: "success_rate",
        accessorFn: (node) => {
          const calls = (node.success_count || 0) + (node.failure_count || 0);
          return calls ? (node.success_count || 0) / calls : 0;
        },
        meta: { label: "成功率" } satisfies DataTableColumnMeta,
        header: ({ column }) => <SortableHeader column={column} label="成功率" />,
        cell: ({ row }) => {
          const calls = (row.original.success_count || 0) + (row.original.failure_count || 0);
          const rate = calls ? (((row.original.success_count || 0) / calls) * 100).toFixed(1) : "0.0";
          return <span className="font-mono">{rate}%</span>;
        }
      },
      {
        id: "calls",
        accessorFn: (node) => (node.success_count || 0) + (node.failure_count || 0),
        meta: { label: "成功/失败" } satisfies DataTableColumnMeta,
        header: ({ column }) => <SortableHeader column={column} label="成功/失败" />,
        cell: ({ row }) => (
          <span className="font-mono">
            <span className="text-success">{row.original.success_count || 0}</span>
            <span className="px-1 text-muted-foreground">/</span>
            <span className="text-destructive">{row.original.failure_count || 0}</span>
          </span>
        )
      },
      {
        accessorKey: "active_connections",
        meta: { label: "连接" } satisfies DataTableColumnMeta,
        header: ({ column }) => <SortableHeader column={column} label="连接" />,
        cell: ({ row }) => <span className="font-mono">{row.original.active_connections || 0}</span>
      },
      {
        id: "timeline",
        enableSorting: false,
        meta: { label: "时间线" } satisfies DataTableColumnMeta,
        header: "时间线",
        cell: ({ row }) => <TimelineDots node={row.original} />
      }
    ],
    []
  );

  return (
    <DataTable
      columns={columns}
      data={nodes}
      filterColumn="name"
      filterPlaceholder="筛选诊断节点..."
      emptyLabel="暂无诊断数据"
    />
  );
}

function NodeTable({
  nodes,
  regionVisuals,
  onProbe,
  onRelease,
  onBlacklist
}: {
  nodes: NodeSnapshot[];
  regionVisuals: RegionVisuals;
  onProbe: (tag: string) => void;
  onRelease: (tag: string) => void;
  onBlacklist: (tag: string) => void;
}) {
  const columns = useMemo<Array<ColumnDef<NodeSnapshot, unknown>>>(
    () => [
      {
        id: "status",
        accessorFn: (node) => nodeStatus(node).label,
        meta: { label: "状态" } satisfies DataTableColumnMeta,
        header: "状态",
        cell: ({ row }) => {
          const status = nodeStatus(row.original);
          return <Badge variant={status.variant}>{status.label}</Badge>;
        }
      },
      {
        accessorKey: "region",
        meta: { label: "地域" } satisfies DataTableColumnMeta,
        header: "地域",
        cell: ({ row }) => (
          <RegionCell
            region={row.original.region}
            exitIp={row.original.exit_ip}
            visual={regionVisual(regionVisuals, row.original.region)}
          />
        )
      },
      {
        id: "name",
        accessorFn: (node) => `${node.name || ""} ${node.tag || ""}`,
        meta: { label: "节点" } satisfies DataTableColumnMeta,
        header: ({ column }) => <SortableHeader column={column} label="节点" />,
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.name || row.original.tag}</div>
            <div className="max-w-[280px] truncate font-mono text-xs text-muted-foreground">
              {row.original.tag}
            </div>
          </div>
        )
      },
      {
        accessorKey: "port",
        meta: { label: "端口" } satisfies DataTableColumnMeta,
        header: ({ column }) => <SortableHeader column={column} label="端口" />,
        cell: ({ row }) => <span className="font-mono">{row.original.port || "-"}</span>
      },
      {
        accessorKey: "last_latency_ms",
        meta: { label: "延迟" } satisfies DataTableColumnMeta,
        header: ({ column }) => <SortableHeader column={column} label="延迟" />,
        cell: ({ row }) => {
          const latency = row.original.last_latency_ms ?? -1;
          return (
            <div className="flex min-w-[120px] items-center gap-2">
              <span className="w-12 font-mono text-xs">{latency >= 0 ? `${latency}ms` : "-"}</span>
              <QualityBar latency={latency} />
            </div>
          );
        }
      },
      {
        accessorKey: "active_connections",
        meta: { label: "连接" } satisfies DataTableColumnMeta,
        header: ({ column }) => <SortableHeader column={column} label="连接" />,
        cell: ({ row }) => <span className="font-mono">{row.original.active_connections || 0}</span>
      },
      {
        accessorKey: "failure_count",
        meta: { label: "失败" } satisfies DataTableColumnMeta,
        header: ({ column }) => <SortableHeader column={column} label="失败" />,
        cell: ({ row }) => (
          <span className={cn("font-mono", (row.original.failure_count || 0) > 0 && "text-destructive")}>
            {row.original.failure_count || 0}
          </span>
        )
      },
      {
        id: "actions",
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex min-w-[152px] items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onProbe(row.original.tag)}
                >
                  <Zap className="h-4 w-4" />
                  探测
                </Button>
              </TooltipTrigger>
              <TooltipContent>立即探测节点延迟</TooltipContent>
            </Tooltip>
            {row.original.blacklisted ? (
              <Button type="button" size="sm" onClick={() => onRelease(row.original.tag)}>
                <RotateCcw className="h-4 w-4" />
                解封
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => onBlacklist(row.original.tag)}
              >
                <Trash2 className="h-4 w-4" />
                拉黑
              </Button>
            )}
          </div>
        )
      }
    ],
    [onBlacklist, onProbe, onRelease, regionVisuals]
  );

  return (
    <DataTable
      columns={columns}
      data={nodes}
      filterColumn="name"
      filterPlaceholder="筛选节点..."
      emptyLabel="暂无数据"
    />
  );
}

function DataTable<TData, TValue>({
  columns,
  data,
  filterColumn,
  filterPlaceholder,
  emptyLabel
}: {
  columns: Array<ColumnDef<TData, TValue>>;
  data: TData[];
  filterColumn: string;
  filterPlaceholder: string;
  emptyLabel: string;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      columnVisibility
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    initialState: {
      pagination: {
        pageSize: 10
      }
    }
  });

  return (
    <div>
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <Input
          value={(table.getColumn(filterColumn)?.getFilterValue() as string) ?? ""}
          onChange={(event) => table.getColumn(filterColumn)?.setFilterValue(event.target.value)}
          placeholder={filterPlaceholder}
          className="max-w-sm"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline">
              <SlidersHorizontal className="h-4 w-4" />
              列
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide())
              .map((column) => {
                const meta = column.columnDef.meta as DataTableColumnMeta | undefined;
                return (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) => column.toggleVisibility(Boolean(value))}
                  >
                    {meta?.label || column.id}
                  </DropdownMenuCheckboxItem>
                );
              })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                {emptyLabel}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">
          {table.getFilteredRowModel().rows.length} 行
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            上一页
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            下一页
          </Button>
        </div>
      </div>
    </div>
  );
}

function SortableHeader({
  column,
  label
}: {
  column: {
    toggleSorting: (desc?: boolean) => void;
    getIsSorted: () => false | "asc" | "desc";
  };
  label: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="-ml-3 h-8 px-2 data-[state=open]:bg-accent"
      onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
    >
      {label}
      <ArrowUpDown className="h-3.5 w-3.5" />
    </Button>
  );
}

function RegionCell({
  region,
  exitIp,
  visual
}: {
  region?: string;
  exitIp?: string;
  visual: RegionVisual;
}) {
  return (
    <div className="flex min-w-[112px] items-center gap-2">
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-base shadow-sm"
        style={{
          background: `linear-gradient(135deg, ${visual.surface}, ${hexToRgba(visual.color, 0.2)})`,
          borderColor: visual.border,
          color: visual.text
        }}
      >
        {visual.flag}
      </span>
      <span className="min-w-0">
        <span className="block font-medium" style={{ color: visual.text }}>
          {(region || "other").toUpperCase()}
        </span>
        <span className="block truncate font-mono text-xs text-muted-foreground">
          {exitIp || "-"}
        </span>
      </span>
    </div>
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

function WarpRegisterDialog({
  open,
  onOpenChange,
  form,
  setForm,
  registering,
  onSubmit
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: WarpRegisterForm;
  setForm: React.Dispatch<React.SetStateAction<WarpRegisterForm>>;
  registering: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !registering && onOpenChange(nextOpen)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>注册 Cloudflare WARP</DialogTitle>
          <DialogDescription>创建普通 WARP 节点，注册成功后核心会自动重载生效。</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          <Field label="名称">
            <Input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="WARP-01"
              disabled={registering}
              required
            />
          </Field>
          <div className="grid gap-4 md:grid-cols-[1fr_8rem]">
            <Field label="Endpoint">
              <Input
                value={form.endpoint}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, endpoint: event.target.value }))
                }
                placeholder={DEFAULT_WARP_ENDPOINT}
                disabled={registering}
                required
              />
            </Field>
            <Field label="端口">
              <Input
                type="number"
                min={1}
                max={65535}
                value={form.endpoint_port}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    endpoint_port: Number(event.target.value)
                  }))
                }
                disabled={registering}
                required
              />
            </Field>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={registering}
            >
              取消
            </Button>
            <Button type="submit" disabled={registering}>
              {registering ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {registering ? "注册中" : "注册并生效"}
            </Button>
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80">
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
  const toneStyle = {
    default: {
      value: "text-foreground",
      icon: "bg-muted text-muted-foreground"
    },
    success: {
      value: "text-success",
      icon: "bg-success/10 text-success"
    },
    primary: {
      value: "text-primary",
      icon: "bg-primary/10 text-primary"
    },
    destructive: {
      value: "text-destructive",
      icon: "bg-destructive/10 text-destructive"
    }
  }[tone];

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
          <div className={cn("h-2 w-2 rounded-full", toneStyle.icon)} />
        </div>
        <div
          className={cn(
            "mt-2 truncate font-mono font-semibold tracking-normal",
            compact ? "text-xl" : "text-3xl",
            toneStyle.value
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
      <CardHeader className="border-b pb-3">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <ChartContainer ref={ref} className="h-[260px]" />
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="p-5">
        <FieldSet>
          <FieldLegend>{title}</FieldLegend>
          <FieldGroup>{children}</FieldGroup>
        </FieldSet>
      </CardContent>
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
    <FieldRoot className={className}>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </FieldRoot>
  );
}

function SwitchField({
  label,
  checked,
  onCheckedChange,
  description
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  description?: string;
}) {
  return (
    <FieldRoot className="flex min-h-10 flex-row items-center justify-between gap-4 rounded-md border bg-background px-3 py-2">
      <div className="grid gap-1">
        <FieldLabel className="leading-5">{label}</FieldLabel>
        {description ? <FieldDescription className="text-xs">{description}</FieldDescription> : null}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </FieldRoot>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="p-12 text-center text-sm text-muted-foreground">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md border border-dashed bg-muted text-muted-foreground">
        <FileText className="h-4 w-4" />
      </div>
      {label}
    </div>
  );
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
      <div
        className={cn("h-full rounded-full shadow-sm", color)}
        style={{ width: `${width}%` }}
      />
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
            "h-2.5 w-2.5 rounded-full ring-2 ring-background",
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

function canCountInRegionPie(node: NodeSnapshot) {
  if (node.blacklisted) return false;
  if (node.initial_check_done && !node.available) return false;
  return true;
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
      password: settings.management?.password || "",
      health_check_interval: settings.management?.health_check_interval || "5m",
      health_check_concurrency: settings.management?.health_check_concurrency
        ? String(settings.management.health_check_concurrency)
        : "",
      initial_check_concurrency: settings.management?.initial_check_concurrency
        ? String(settings.management.initial_check_concurrency)
        : ""
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
      exit_ip_probe_mode: normalizeExitIPProbeMode(settings.geoip?.exit_ip_probe_mode),
      exit_ip_probe_interval: settings.geoip?.exit_ip_probe_interval || "5m",
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
      password: form.management.password,
      health_check_interval: form.management.health_check_interval || "5m",
      health_check_concurrency: Number(form.management.health_check_concurrency) || 0,
      initial_check_concurrency: Number(form.management.initial_check_concurrency) || 0
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
      exit_ip_probe_mode: normalizeExitIPProbeMode(form.geoip.exit_ip_probe_mode),
      exit_ip_probe_interval: form.geoip.exit_ip_probe_interval || "5m",
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
    repo: update.repo || DEFAULT_UPDATE_FORM.repo,
    use_fastest_node: Boolean(update.use_fastest_node)
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

function normalizeExitIPProbeMode(mode?: string) {
  return mode === "subscription_refresh" ? "subscription_refresh" : "interval";
}

function useFlagRegionVisuals(themeMode: ThemeMode): RegionVisuals {
  const [baseColors, setBaseColors] = useState<Record<string, string>>(REGION_FALLBACK_COLORS);

  useEffect(() => {
    let mounted = true;

    void resolveFlagRegionColors().then((colors) => {
      if (mounted) {
        setBaseColors((current) => ({ ...current, ...colors }));
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  return useMemo(() => buildRegionVisuals(baseColors, themeMode), [baseColors, themeMode]);
}

async function resolveFlagRegionColors() {
  if (typeof document === "undefined") return REGION_FALLBACK_COLORS;

  try {
    await document.fonts?.ready;
  } catch {
    // Continue with fallback emoji/system fonts.
  }

  const entries = await Promise.all(
    REGION_OPTIONS.map(async (region) => [
      region.value,
      extractBlurredFlagColor(region)
    ] as const)
  );

  return Object.fromEntries(entries);
}

function extractBlurredFlagColor(region: RegionSeed) {
  if (typeof document === "undefined") return region.fallback;

  try {
    const size = 64;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement("canvas");
    canvas.width = size * scale;
    canvas.height = size * scale;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return region.fallback;

    ctx.scale(scale, scale);
    ctx.clearRect(0, 0, size, size);
    ctx.font = '48px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.filter = "blur(7px) saturate(1.12)";
    ctx.fillText(region.flag, size / 2, size / 2 + 1);

    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return normalizeFlagColor(sampleFlagPixels(pixels), region.fallback);
  } catch {
    return region.fallback;
  }
}

function sampleFlagPixels(pixels: Uint8ClampedArray) {
  let red = 0;
  let green = 0;
  let blue = 0;
  let totalWeight = 0;

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] / 255;
    if (alpha < 0.06) continue;

    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];
    const [, saturation, lightness] = rgbToHsl(r, g, b);
    const whitePenalty = lightness > 0.86 && saturation < 0.16 ? 0.1 : 1;
    const grayPenalty = saturation < 0.08 ? 0.2 : 1;
    const darkPenalty = lightness < 0.12 ? 0.24 : 1;
    const weight = alpha * (0.18 + saturation * 1.9) * whitePenalty * grayPenalty * darkPenalty;

    red += r * weight;
    green += g * weight;
    blue += b * weight;
    totalWeight += weight;
  }

  if (totalWeight < 1) return null;

  return {
    r: Math.round(red / totalWeight),
    g: Math.round(green / totalWeight),
    b: Math.round(blue / totalWeight)
  };
}

function normalizeFlagColor(
  sampled: { r: number; g: number; b: number } | null,
  fallback: string
) {
  if (!sampled) return fallback;

  const [hue, saturation, lightness] = rgbToHsl(sampled.r, sampled.g, sampled.b);
  if (saturation < 0.18) return fallback;

  return hslToHex(hue, clamp(saturation * 1.18, 0.48, 0.82), clamp(lightness, 0.36, 0.56));
}

function buildRegionVisuals(baseColors: Record<string, string>, themeMode?: ThemeMode) {
  const isDark = isDarkTheme(themeMode);

  return REGION_OPTIONS.reduce<RegionVisuals>((visuals, region) => {
    visuals[region.value] = buildRegionVisual(region, baseColors[region.value] || region.fallback, isDark);
    return visuals;
  }, {});
}

function buildRegionVisual(region: RegionSeed, color: string, isDark: boolean): RegionVisual {
  return {
    ...region,
    color,
    surface: hexToRgba(color, isDark ? 0.2 : 0.12),
    border: hexToRgba(color, isDark ? 0.5 : 0.34),
    text: isDark ? mixHex(color, "#ffffff", 0.36) : mixHex(color, "#0f172a", 0.14)
  };
}

function regionVisual(visuals: RegionVisuals, region?: string) {
  const key = normalizeRegionKey(region);
  if (visuals[key]) return visuals[key];

  const fallback = hashRegionColor(key);
  return buildRegionVisual(
    {
      value: key,
      label: key.toUpperCase(),
      flag: REGION_SEEDS[key]?.flag || "◌",
      fallback
    },
    fallback,
    isDarkTheme()
  );
}

function sortRegionKeys(keys: string[]) {
  const knownOrder = REGION_OPTIONS.map((region) => region.value).filter((key) => key !== "all");
  const uniqueKeys = Array.from(new Set(keys.map(normalizeRegionKey)));

  return [
    ...knownOrder.filter((key) => uniqueKeys.includes(key)),
    ...uniqueKeys.filter((key) => !knownOrder.includes(key))
  ];
}

function normalizeRegionKey(region?: string) {
  return (region || "other").trim().toLowerCase() || "other";
}

function formatBytes(bytes: number, decimals = 2) {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.max(0, Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1));
  return `${Number.parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

function formatCount(value: number) {
  const count = Math.max(0, Math.round(value || 0));
  return new Intl.NumberFormat("zh-CN", {
    notation: count >= 100000 ? "compact" : "standard",
    maximumFractionDigits: 1
  }).format(count);
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

function isDarkTheme(mode?: ThemeMode) {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return true;
  }
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

function chartPalette(mode?: ThemeMode) {
  return {
    background: cssVarColor("--card", mode),
    foreground: cssVarColor("--foreground", mode),
    muted: cssVarColor("--muted-foreground", mode),
    border: cssVarColor("--border", mode),
    primary: cssVarColor("--chart-1", mode),
    success: cssVarColor("--chart-2", mode),
    warning: cssVarColor("--chart-3", mode),
    destructive: cssVarColor("--chart-4", mode),
    accent: cssVarColor("--chart-5", mode)
  };
}

function cssVarColor(name: string, mode?: ThemeMode) {
  if (typeof window === "undefined") {
    return "hsl(0, 0%, 50%)";
  }
  const dark = isDarkTheme(mode);
  const rootDark = document.documentElement.classList.contains("dark");
  if (dark !== rootDark) {
    return cssVarFallbackColor(name, dark);
  }

  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (value) return hslVarToChartColor(value);

  return cssVarFallbackColor(name, dark);
}

function hslVarToChartColor(value: string) {
  const [channels, alpha] = value.split("/");
  const parts = channels.trim().split(/\s+/);
  if (parts.length >= 3) {
    const [hue, saturation, lightness] = parts;
    const alphaValue = alpha?.trim();
    return alphaValue
      ? `hsla(${hue}, ${saturation}, ${lightness}, ${alphaValue})`
      : `hsl(${hue}, ${saturation}, ${lightness})`;
  }
  return value;
}

function cssVarFallbackColor(name: string, dark: boolean) {
  if (name === "--card") return dark ? "hsl(0, 0%, 3.9%)" : "hsl(0, 0%, 100%)";
  if (name === "--foreground") return dark ? "hsl(210, 40%, 98%)" : "hsl(0, 0%, 3.9%)";
  if (name === "--muted-foreground") return dark ? "hsl(0, 0%, 63.9%)" : "hsl(0, 0%, 45.1%)";
  if (name === "--border") return dark ? "hsl(0, 0%, 14.9%)" : "hsl(0, 0%, 89.8%)";
  if (name === "--chart-1") return dark ? "hsl(0, 0%, 98%)" : "hsl(0, 0%, 9%)";
  if (name === "--chart-2") return dark ? "hsl(151, 62%, 44%)" : "hsl(151, 62%, 41%)";
  if (name === "--chart-3") return dark ? "hsl(42, 91%, 54%)" : "hsl(42, 91%, 50%)";
  if (name === "--chart-4") return dark ? "hsl(0, 62.8%, 50%)" : "hsl(0, 84.2%, 60.2%)";
  if (name === "--chart-5") return dark ? "hsl(217, 91%, 60%)" : "hsl(221, 83%, 53%)";
  return "hsl(0, 0%, 50%)";
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

function hashRegionColor(region: string) {
  let hash = 0;
  for (let index = 0; index < region.length; index += 1) {
    hash = (hash << 5) - hash + region.charCodeAt(index);
    hash |= 0;
  }

  const hue = (((hash % 360) + 360) % 360) / 360;
  return hslToHex(hue, 0.58, 0.48);
}

function hexToRgba(hex: string, alpha: number) {
  const rgb = hexToRgb(hex);
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function mixHex(hex: string, targetHex: string, amount: number) {
  const color = hexToRgb(hex);
  const target = hexToRgb(targetHex);
  const mix = clamp(amount, 0, 1);

  return rgbToHex({
    r: Math.round(color.r + (target.r - color.r) * mix),
    g: Math.round(color.g + (target.g - color.g) * mix),
    b: Math.round(color.b + (target.b - color.b) * mix)
  });
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "").trim();
  const value =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => char + char)
          .join("")
      : normalized.padEnd(6, "0").slice(0, 6);

  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16)
  };
}

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }) {
  return `#${[r, g, b].map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;

  if (max === min) return [0, 0, lightness];

  const delta = max - min;
  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue =
    max === red
      ? (green - blue) / delta + (green < blue ? 6 : 0)
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4;

  hue /= 6;
  return [hue, saturation, lightness];
}

function hslToHex(hue: number, saturation: number, lightness: number) {
  let red = lightness;
  let green = lightness;
  let blue = lightness;

  if (saturation !== 0) {
    const q =
      lightness < 0.5
        ? lightness * (1 + saturation)
        : lightness + saturation - lightness * saturation;
    const p = 2 * lightness - q;
    red = hueToRgb(p, q, hue + 1 / 3);
    green = hueToRgb(p, q, hue);
    blue = hueToRgb(p, q, hue - 1 / 3);
  }

  return rgbToHex({
    r: red * 255,
    g: green * 255,
    b: blue * 255
  });
}

function hueToRgb(p: number, q: number, t: number) {
  let hue = t;
  if (hue < 0) hue += 1;
  if (hue > 1) hue -= 1;
  if (hue < 1 / 6) return p + (q - p) * 6 * hue;
  if (hue < 1 / 2) return q;
  if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6;
  return p;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export default App;
