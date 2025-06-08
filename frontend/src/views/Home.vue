<template>
  <div class="home-container">
    <h1>欢迎使用智能合同审查系统</h1>
    <p>请通过顶部导航栏选择您需要的功能。</p>
    <el-button type="primary" @click="goToReview">开始审查合同</el-button>
  </div>
</template>

<script>
import { defineComponent } from 'vue';
import { useRouter } from 'vue-router';

export default defineComponent({
  name: 'HomeView',
  setup() {
    const router = useRouter();
    const goToReview = () => {
      router.push('/review');
    };

    return {
      goToReview,
    };
  },
});
</script>

<style scoped>
.home-container {
  text-align: center;
  padding: 50px;
}
</style> 