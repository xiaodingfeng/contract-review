<template>
  <div class="flex-shrink-0 mb-2 p-2 bg-white rounded-lg shadow-sm">
    <div class="flex items-center">
      <div class="flex items-center text-xs" :class="activeStep >= 0 ? 'text-primary' : 'text-gray-500'">
        <div class="flex items-center justify-center w-5 h-5 rounded-full border-2" :class="activeStep >= 0 ? 'border-primary' : 'border-gray-400'">
          <span v-if="activeStep > 0">✓</span><span v-else>1</span>
        </div>
        <span class="ml-1 font-semibold">上传合同</span>
      </div>
      <div class="flex-auto border-t-2 mx-2" :class="activeStep >= 1 ? 'border-primary' : 'border-gray-300'"></div>
      <div class="flex items-center text-xs" :class="activeStep >= 1 ? 'text-primary' : 'text-gray-500'">
        <div class="flex items-center justify-center w-5 h-5 rounded-full border-2" :class="activeStep >= 1 ? 'border-primary' : 'border-gray-400'">
           <span v-if="activeStep > 1">✓</span><span v-else>2</span>
        </div>
        <span class="ml-1 font-semibold">确认信息并分析</span>
      </div>
      <div class="flex-auto border-t-2 mx-2" :class="activeStep >= 2 ? 'border-primary' : 'border-gray-300'"></div>
      <div class="flex items-center text-xs" :class="activeStep >= 2 ? 'text-primary' : 'text-gray-500'">
        <div class="flex items-center justify-center w-5 h-5 rounded-full border-2" :class="activeStep >= 2 ? 'border-primary' : 'border-gray-400'">
          <span>3</span>
        </div>
        <span class="ml-1 font-semibold">查看并编辑结果</span>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'StepHeader',
  setup() {
    return {};
  },
  props: {
    activeStep: { type: Number, default: 0 },
  },
};
</script>
