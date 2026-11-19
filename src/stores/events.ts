// 轻量应用内事件总线，用于打破 store 之间的循环依赖

type Listener<T> = (payload: T) => void;

function createEmitter<T>() {
  const listeners = new Set<Listener<T>>();
  return {
    on(fn: Listener<T>) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    emit(payload: T) {
      listeners.forEach((fn) => {
        try {
          fn(payload);
        } catch (e) {
          console.error(e);
        }
      });
    },
  };
}

export const fileSavedEvent = createEmitter<{ path: string }>();
