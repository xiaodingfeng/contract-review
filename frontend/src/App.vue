<template>
  <div id="app">
    <el-container class="app-container">
      <el-header class="app-header">
        <div class="logo-area">
          <img alt="App logo" src="./assets/logo.png" class="logo-img">
          <span class="logo-text">智能合同审查系统</span>
        </div>
        <el-menu :default-active="$route.path" class="app-menu" mode="horizontal" :router="true" @select="handleMenuSelect">
          <el-menu-item index="/">合同审查</el-menu-item>
          <el-menu-item index="/history">审核历史</el-menu-item>
          <el-menu-item index="/qna">合同问答</el-menu-item>
          <el-menu-item index="/settings">设置</el-menu-item>
        </el-menu>
      </el-header>
      <el-main class="app-main">
        <router-view class="content-view"/>
      </el-main>
    </el-container>
  </div>
</template>

<script>
export default {
  name: 'App',
  methods: {
    handleMenuSelect(index) {
      // The :router="true" prop handles navigation automatically.
      // This method is kept for potential future use, e.g., logging.
      console.log('Navigating to:', index);
    }
  }
}
</script>

<style>
/* Basic reset and global styles */
html, body, #app {
  height: 100%;
  margin: 0;
  padding: 0;
  font-family: 'Helvetica Neue', Helvetica, 'PingFang SC', 'Hiragino Sans GB',
    'Microsoft YaHei', '微软雅黑', Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  background-color: #f2f3f5;
}

.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: solid 1px var(--el-menu-border-color);
  padding: 0 20px;
}

.logo-area {
  display: flex;
  align-items: center;
}

.logo-img {
  width: 30px;
  height: 30px;
  margin-right: 10px;
}

.logo-text {
  font-size: 18px;
  font-weight: bold;
}

.app-main {
  padding: 15px; /* Reduce padding */
  height: calc(100vh - 40px); /* Adjust for header height */
  box-sizing: border-box;
}

.content-view {
  background-color: #ffffff;
  padding: 20px;
  border-radius: 4px;
  border: 1px solid #e4e7ed;
  min-height: calc(100vh - 140px); /* Adjust based on new header+tabs height */
  height: 100%;
  box-sizing: border-box;
  display: flex; /* Ensure content inside can flex correctly */
  flex-direction: column;
}
</style> 