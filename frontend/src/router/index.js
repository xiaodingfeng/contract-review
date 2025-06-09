import { createRouter, createWebHistory } from 'vue-router'
import Review from '../views/Review.vue'
import Home from '../views/Home.vue'
import QnA from '../views/QnA.vue'
import Settings from '../views/Settings.vue'

const routes = [
  {
    path: '/',
    name: 'Home',
    component: Home
  },
  {
    path: '/review',
    name: 'Review',
    component: Review
  },
  {
    path: '/history',
    redirect: '/'
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