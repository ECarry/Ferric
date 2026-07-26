import { invoke } from '@tauri-apps/api/core'
import type { SshConnectConfig } from './ssh'

export interface DockerInfo {
  version: string
  apiVersion: string
  os: string
  arch: string
}

export interface DockerContainer {
  id: string
  image: string
  command: string
  createdAt: string
  status: string
  names: string
}

export interface CreateDockerContainerInput {
  name?: string
  image: string
  command?: string
}

/** 获取远程服务器的 Docker 版本信息 */
export function getRemoteDockerVersion(config: SshConnectConfig): Promise<DockerInfo> {
  // 必须确保传递的对象形如: { config: config }
  return invoke<DockerInfo>('get_remote_docker_version', { config })
}

/** 获取远程服务器的容器列表 */
export function listRemoteContainers(config: SshConnectConfig, all = true): Promise<DockerContainer[]> {
  return invoke<DockerContainer[]>('list_remote_containers', { config, all })
}

/** 控制远程容器状态 */
export function controlRemoteContainer(
  config: SshConnectConfig,
  containerId: string,
  action: 'start' | 'stop' | 'restart'
): Promise<void> {
  return invoke<void>('control_remote_container', {
    config,
    containerId,
    action,
  })
}

/** 创建并启动一个远程容器。 */
export function createRemoteContainer(
  config: SshConnectConfig,
  input: CreateDockerContainerInput,
): Promise<void> {
  return invoke<void>('create_remote_container', { config, input })
}

/** 重命名远程容器。Docker 不支持原地修改镜像或启动命令。 */
export function renameRemoteContainer(
  config: SshConnectConfig,
  containerId: string,
  name: string,
): Promise<void> {
  return invoke<void>('rename_remote_container', { config, containerId, name })
}
