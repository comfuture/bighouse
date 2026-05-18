import { createRouter, createWebHistory } from "vue-router";
import GameListView from "./views/GameListView.vue";
import LobbyView from "./views/LobbyView.vue";
import RoomView from "./views/RoomView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "games", component: GameListView },
    { path: "/lobbies/:gameId/:mode", name: "lobby", component: LobbyView },
    { path: "/play/:roomId", name: "room", component: RoomView }
  ]
});
