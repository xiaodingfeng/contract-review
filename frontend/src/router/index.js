import { createRouter, createWebHistory } from 'vue-router'
import Review from '../views/Review.vue'
import History from '../views/History.vue'
import QnA from '../views/QnA.vue'
import Settings from '../views/Settings.vue'

const routes = [
  {
    path: '/',
    name: 'Review',
    component: Review
  },
  {
    path: '/history',
    name: 'History',
    component: History
  },
  {
    path: '/qna',
    name: 'QnA',
    component: QnA
  },
  {
    path: '/settings',
    name: 'Settings',
    component: Settings
  }
]

const router = createRouter({
  history: createWebHistory(process.env.BASE_URL),
  routes
})

export default router 