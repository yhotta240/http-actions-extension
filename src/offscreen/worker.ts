import {
  executePreparedHttpRequest,
  type PreparedHttpRequest,
} from "../utils/executor";

self.onmessage = async (event: MessageEvent<PreparedHttpRequest>) => {
  const result = await executePreparedHttpRequest(event.data);
  self.postMessage(result);
};
