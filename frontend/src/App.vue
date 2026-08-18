<template>
  <div id="app">
    <header class="app-header">
      <router-link to="/" class="brand" aria-label="众安集团合同审核首页">
        <img src="/asserts/zhongan-logo.png" alt="众安集团" />
        <span class="brand-divider" aria-hidden="true"></span>
        <span class="brand-copy">
          <strong>合同审核</strong>
          <small>INTERNAL REVIEW</small>
        </span>
      </router-link>
      <div class="header-actions">
        <nav class="app-nav" aria-label="主导航">
          <router-link to="/" class="nav-link" active-class="nav-link-active">工作台</router-link>
          <router-link to="/review" class="nav-link" active-class="nav-link-active">合同审核</router-link>
          <router-link to="/qna" class="nav-link" active-class="nav-link-active">智能问答</router-link>
          <router-link to="/settings" class="nav-link" active-class="nav-link-active">知识库</router-link>
        </nav>
        <span class="poc-badge"><i></i>内部试用</span>
      </div>
    </header>
    <router-view />
  </div>
</template>

<script>
export default {
  name: 'App',
};
</script>

<style>
:root {
  --za-teal: #008c88;
  --za-teal-deep: #006f6c;
  --za-gold: #d2ae62;
  --za-gold-ink: #876528;
  --za-gold-soft: #f4ead2;
  --za-ink: #173533;
  --za-muted: #6c7c7a;
  --za-canvas: #f4f6f2;
  --za-line: #dde4df;
  --el-color-primary: #008c88;
  --el-color-primary-light-3: #3ca9a5;
  --el-color-primary-light-5: #78c4c1;
  --el-color-primary-light-7: #b5dfdc;
  --el-color-primary-light-8: #d0eae8;
  --el-color-primary-light-9: #edf7f5;
  --el-color-primary-dark-2: #006f6c;
  color: var(--za-ink);
  background: var(--za-canvas);
  font-family: "Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif;
  letter-spacing: 0;
}

* {
  box-sizing: border-box;
}

html,
body,
#app {
  min-height: 100%;
  margin: 0;
}

body {
  background:
    linear-gradient(rgba(255, 255, 255, .88), rgba(255, 255, 255, .88)),
    repeating-linear-gradient(90deg, transparent 0 79px, rgba(0, 140, 136, .035) 79px 80px),
    var(--za-canvas);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

a {
  color: inherit;
}

a:focus-visible,
button:focus-visible,
input:focus-visible,
select:focus-visible,
[tabindex]:focus-visible {
  outline: 2px solid var(--za-teal);
  outline-offset: 3px;
}

.app-header {
  position: sticky;
  top: 0;
  z-index: 40;
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 0 clamp(18px, 3vw, 46px);
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(20px);
  box-shadow: inset 0 -1px 0 rgba(210, 174, 98, .55), 0 8px 24px rgba(23, 53, 51, .04);
}

.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  color: var(--za-ink);
  text-decoration: none;
  white-space: nowrap;
}

.brand img {
  width: 118px;
  height: auto;
}

.brand-divider {
  width: 1px;
  height: 30px;
  background: #e1d3b2;
}

.brand-copy {
  display: grid;
  gap: 2px;
}

.brand-copy strong {
  font-family: "Songti SC", "STSong", serif;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: .08em;
}

.brand-copy small {
  color: var(--za-gold);
  font-family: Georgia, serif;
  font-size: 7px;
  font-weight: 700;
  letter-spacing: .15em;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 22px;
}

.app-nav {
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
}

.nav-link {
  display: inline-flex;
  align-items: center;
  position: relative;
  min-height: 72px;
  padding: 0 16px;
  color: #526765;
  text-decoration: none;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  transition: color 0.18s ease;
}

.nav-link:hover {
  color: var(--za-teal);
}

.nav-link-active {
  color: var(--za-teal);
}

.nav-link-active::after {
  content: '';
  position: absolute;
  right: 16px;
  bottom: 0;
  left: 16px;
  height: 3px;
  background: var(--za-gold);
}

.poc-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  border: 1px solid #dce8e4;
  border-radius: 2px;
  color: #52706d;
  background: #f7faf8;
  font-size: 11px;
  white-space: nowrap;
}

.poc-badge i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--za-teal);
  box-shadow: 0 0 0 3px rgba(0, 140, 136, .12);
}

.el-button,
.el-input__wrapper,
.el-textarea__inner,
.el-select__wrapper {
  border-radius: 3px !important;
}

.el-input__wrapper,
.el-select__wrapper {
  min-height: 34px !important;
}

.el-textarea__inner {
  font-size: 13px !important;
  line-height: 1.45 !important;
}

@media (max-width: 680px) {
  .app-header {
    height: auto;
    min-height: 64px;
    align-items: flex-start;
    flex-direction: column;
    padding: 10px 14px 0;
  }

  .app-nav {
    width: 100%;
  }

  .header-actions {
    width: 100%;
  }

  .nav-link {
    min-height: 44px;
    padding: 0 10px;
  }

  .nav-link-active::after {
    right: 10px;
    left: 10px;
  }

  .poc-badge {
    display: none;
  }
}
</style>
