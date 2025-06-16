<template>
  <div id="app" class="h-screen flex flex-col bg-bg-main font-sans">
    <!-- Header -->
    <header class="flex-shrink-0 bg-white border-b border-border-color shadow-sm">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="flex items-center justify-between h-9">
                <router-link to="/" class="flex items-center no-underline">
                    <div class="flex-shrink-0 text-primary font-bold text-lg flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        合同审查
                    </div>
                </router-link>
            </div>
        </div>
    </header>

    <!-- Main Content -->
    <main class="flex-grow pl-4 pr-4">
       <router-view></router-view>
    </main>
  </div>
</template>

<script>
export default {
  name: 'App',
};
</script>

<style>
/* Remove all component-specific styles, handled by Tailwind now */
#app {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

html {
  overflow-y: scroll;
}

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji';
}

.nav-link {
    @apply text-text-light px-3 py-1 rounded-md text-sm font-medium transition-colors duration-200;
}

.nav-link:hover {
    @apply text-text-dark bg-bg-subtle;
}

.nav-link-active {
    @apply bg-primary-light text-primary-dark;
}
</style>
