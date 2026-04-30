declare namespace chrome {
  namespace devtools {
    const inspectedWindow: {
      tabId: number;
    };

    const panels: {
      create(
        title: string,
        iconPath: string,
        pagePath: string,
        callback?: (panel: unknown) => void,
      ): void;
    };
  }

  namespace runtime {
    interface MessageSender {
      tab?: {
        id?: number;
      };
    }

    interface Port {
      name: string;
      postMessage(message: unknown): void;
      onMessage: {
        addListener(listener: (message: unknown) => void): void;
      };
      onDisconnect: {
        addListener(listener: () => void): void;
      };
    }

    const onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response?: unknown) => void,
        ) => boolean | undefined,
      ): void;
    };

    const onConnect: {
      addListener(listener: (port: Port) => void): void;
    };

    function connect(options: { name: string }): Port;
    function getURL(path: string): string;
    function sendMessage(message: unknown): void;
  }
}
