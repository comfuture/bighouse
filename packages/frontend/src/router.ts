import { createRouter, createWebHistory } from "vue-router";
import GameListView from "./views/GameListView.vue";
import LobbyView from "./views/LobbyView.vue";
import RoomView from "./views/RoomView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "games", component: GameListView },
    {
      path: "/game/:gameId/:roomId(room_[A-Za-z0-9_]+)",
      name: "room",
      component: RoomView,
      meta: { immersive: true }
    },
    { path: "/game/:gameId/:mode", name: "lobby", component: LobbyView }
  ]
});
