// プリロードが公開する window.api の型を、画面側のコードに教える。
import type { Api } from '../shared/types';

declare global {
  interface Window {
    api: Api;
  }
}
