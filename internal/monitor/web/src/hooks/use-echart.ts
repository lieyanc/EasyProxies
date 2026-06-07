import { useEffect, useRef } from "react";
import * as echarts from "echarts";

export function useEChart(
  option: echarts.EChartsOption | null,
  deps: React.DependencyList,
  active = true
) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!active || !ref.current || !option) {
      return;
    }

    const chart = chartRef.current ?? echarts.init(ref.current, null, { renderer: "canvas" });
    chartRef.current = chart;
    chart.setOption(option, true);

    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    const observer = new ResizeObserver(resize);
    observer.observe(ref.current);

    return () => {
      window.removeEventListener("resize", resize);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, option, ...deps]);

  useEffect(() => {
    return () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  return ref;
}
