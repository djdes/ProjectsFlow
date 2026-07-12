/// <reference types="vite/client" />

// @fontsource-variable/* пакеты — это чистые CSS side-effect импорты, типов не имеют.
declare module '@fontsource-variable/inter';
declare module '@fontsource-variable/jetbrains-mono';

// Маркер сборки (git sha), подставляется vite define из GITHUB_SHA на CI.
declare const __PF_BUILD__: string;
