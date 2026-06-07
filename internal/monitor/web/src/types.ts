export type TabId = "dashboard" | "manage" | "debug" | "logs" | "ota" | "settings";
export type ThemeMode = "auto" | "dark" | "light";

export type NodeSnapshot = {
  tag: string;
  name: string;
  uri?: string;
  mode?: string;
  listen_address?: string;
  port?: number;
  region?: string;
  country?: string;
  exit_ip?: string;
  failure_count?: number;
  success_count?: number;
  blacklisted?: boolean;
  blacklisted_until?: string;
  active_connections?: number;
  last_error?: string;
  last_failure?: string;
  last_success?: string;
  last_probe_latency?: number;
  last_latency_ms?: number;
  available?: boolean;
  initial_check_done?: boolean;
  timeline?: TimelineEvent[];
};

export type TimelineEvent = {
  time: string;
  success: boolean;
  latency_ms: number;
  error?: string;
};

export type NodesResponse = {
  nodes: NodeSnapshot[];
  total_nodes?: number;
  region_stats?: Record<string, number>;
  region_healthy?: Record<string, number>;
};

export type DebugResponse = {
  nodes: NodeSnapshot[];
  total_calls: number;
  total_success: number;
  success_rate: number;
};

export type ConfigNode = {
  name: string;
  uri: string;
  port?: number;
  username?: string;
  password?: string;
  source?: string;
};

export type SubscriptionStatus = {
  enabled: boolean;
  message?: string;
  last_refresh?: string;
  next_refresh?: string;
  node_count?: number;
  last_error?: string;
  refresh_count?: number;
  is_refreshing?: boolean;
  nodes_modified?: boolean;
};

export type SubscriptionConfig = {
  subscriptions: string[];
  enabled: boolean;
  interval: string;
};

export type SettingsResponse = {
  external_ip?: string;
  probe_target?: string;
  skip_cert_verify?: boolean;
  mode?: string;
  listener?: {
    address?: string;
    port?: number;
    username?: string;
    password?: string;
  };
  multi_port?: {
    address?: string;
    base_port?: number;
    username?: string;
    password?: string;
  };
  pool?: {
    mode?: string;
    failure_threshold?: number;
    blacklist_duration?: string;
  };
  management?: {
    listen?: string;
    password?: string;
  };
  log?: {
    output?: string;
    file?: string;
    max_size?: number;
    max_backups?: number;
    max_age?: number;
    compress?: boolean;
  };
  geoip?: {
    enabled?: boolean;
    database_path?: string;
    listen?: string;
    port?: number;
    auto_update_enabled?: boolean;
    auto_update_interval?: string;
    download_proxies?: string[];
  };
  update?: UpdateConfig;
};

export type CoreSettingsForm = {
  mode: string;
  external_ip: string;
  probe_target: string;
  skip_cert_verify: boolean;
  listener: {
    address: string;
    port: string;
    username: string;
    password: string;
  };
  multi_port: {
    address: string;
    base_port: string;
    username: string;
    password: string;
  };
  pool: {
    mode: string;
    failure_threshold: string;
    blacklist_duration: string;
  };
  management: {
    listen: string;
    password: string;
  };
  log: {
    output: string;
    max_size: string;
    max_backups: string;
    max_age: string;
    compress: boolean;
  };
  geoip: {
    enabled: boolean;
    database_path: string;
    listen: string;
    port: string;
    auto_update_enabled: boolean;
    auto_update_interval: string;
    download_proxies: string;
  };
  subscription: {
    enabled: boolean;
    interval: string;
    urls: string;
  };
};

export type UpdateConfig = {
  enabled?: boolean;
  channel?: string;
  check_interval?: string;
  proxy_base_url?: string;
  repo?: string;
};

export type UpdateStatusResponse = {
  enabled: boolean;
  message?: string;
  status?: {
    state?: string;
    latest_version?: string;
    progress?: number;
    error?: string;
    release_notes?: string;
    last_check?: string;
  };
};

export type VersionResponse = {
  version?: {
    version?: string;
    commit?: string;
    build_time?: string;
    update_channel?: string;
    update_repo?: string;
  };
};

export type ProbeProgress = {
  visible: boolean;
  total: number;
  current: number;
  success: number;
  failed: number;
  percent: number;
};

export type TrafficPoint = {
  time: string;
  up: number;
  down: number;
};
