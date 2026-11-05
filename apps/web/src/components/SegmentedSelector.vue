<script setup lang="ts" generic="T extends string">
defineProps<{
  labelledby: string
  options: Array<{ value: T; label: string }>
  modelValue: T
}>()

const emit = defineEmits<{
  'update:modelValue': [value: T]
}>()
</script>

<template>
  <div class="segmented" role="radiogroup" :aria-labelledby="labelledby"><button v-for="option in options" :key="option.value" type="button" role="radio" :aria-checked="modelValue === option.value" :class="{ active: modelValue === option.value }" @click="emit('update:modelValue', option.value)">{{ option.label }}</button></div>
</template>
