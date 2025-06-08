<template>
  <div class="header-component">
    <img src="../assets/logo.png" alt="Logo" class="logo">
    <h1>合同审查 AI 应用</h1>
  </div>
</template>

<script>
export default {
  name: 'HeaderComponent'
}
</script>

<style scoped>
.header-component {
  display: flex;
  align-items: center;
  padding: 10px 20px;
  background-color: #409EFF;
  color: white;
}
.logo {
  height: 40px;
  margin-right: 20px;
}
h1 {
  margin: 0;
  font-size: 20px;
}
</style> 