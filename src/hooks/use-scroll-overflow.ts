import { useState, useEffect, useCallback, type RefObject } from "react";

export interface ScrollOverflow {
  /** 左侧还有内容可滚（已向右滚动了一段）。 */
  canScrollLeft: boolean;
  /** 右侧还有内容可滚（内容比可视区宽且未滚到底）。 */
  canScrollRight: boolean;
}

/**
 * 检测一个横向可滚动容器的溢出状态，返回左右是否还能滚动 —— 用于「溢出才显示滚动箭头」。
 *
 * 可滚动 ⟺ 内容宽度(scrollWidth) > 可视宽度(clientWidth)。左右按当前 scrollLeft 分别判断。
 * 自动挂 `scroll` + `ResizeObserver` + window `resize`；`deps` 变化时重测（内容数量、locale 等改变
 * 会影响宽度）。整个项目的横向滚动箭头都应复用它，避免各处重复写 resize 监听。
 */
export function useScrollOverflow<T extends HTMLElement>(
  ref: RefObject<T | null>,
  deps: unknown[] = []
): ScrollOverflow {
  const [state, setState] = useState<ScrollOverflow>({
    canScrollLeft: false,
    canScrollRight: false,
  });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setState({
      canScrollLeft: el.scrollLeft > 0,
      canScrollRight: el.scrollLeft < el.scrollWidth - el.clientWidth - 1,
    });
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
    // deps 由调用方决定何时重测（如内容/语言变化）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps]);

  return state;
}
