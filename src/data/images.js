// 各云厂商本地内置镜像列表（在线清单拉取失败时的兜底；在线清单可按 value 覆盖/补充）
export const LOCAL_IMAGES = {
  aliyun: [
    { value: 'ubuntu_22_04_x64_20G_alibase_20240101.vhd', label: 'Ubuntu 22.04 LTS (ubuntu_22_04_x64_20G_alibase_20240101.vhd)' },
    { value: 'ubuntu_20_04_x64_20G_alibase_20240101.vhd', label: 'Ubuntu 20.04 LTS (ubuntu_20_04_x64_20G_alibase_20240101.vhd)' },
    { value: 'centos_7_9_x64_20G_alibase_20240101.vhd', label: 'CentOS 7.9 (centos_7_9_x64_20G_alibase_20240101.vhd)' },
    { value: 'alibabacloud_linux_3_x64_20G_alibase_20240101.vhd', label: 'Alibaba Cloud Linux 3 (alibabacloud_linux_3_x64_20G_alibase_20240101.vhd)' },
    { value: 'rocky_linux_9_3_x64_20G_alibase_20240101.vhd', label: 'Rocky Linux 9.3 (rocky_linux_9_3_x64_20G_alibase_20240101.vhd)' },
    { value: 'debian_12_5_x64_20G_alibase_20240101.vhd', label: 'Debian 12.5 (debian_12_5_x64_20G_alibase_20240101.vhd)' },
    { value: 'windows_server_2022_x64_dtc_zh_cn_40G_alibase_20240101.vhd', label: 'Windows Server 2022 (windows_server_2022_x64_dtc_zh_cn_40G_alibase_20240101.vhd)' },
    { value: 'ubuntu_22_04_cuda_12_4_gpu_alibase.vhd', label: 'Ubuntu 22.04 CUDA 12.4 GPU (ubuntu_22_04_cuda_12_4_gpu_alibase.vhd)', gpu: true },
  ],
  tencent: [
    { value: 'img-9qabwvbn', label: 'CentOS 7.6 64bit (img-9qabwvbn)' },
    { value: 'img-3la7wgnt', label: 'Ubuntu Server 20.04 LTS 64bit (img-3la7wgnt)' },
    { value: 'img-pmqg1cw7', label: 'Ubuntu Server 22.04 LTS 64bit (img-pmqg1cw7)' },
    { value: 'img-l8og963d', label: 'TencentOS Server 3.1 64bit (img-l8og963d)' },
    { value: 'img-hi3br8jx', label: 'Windows Server 2019 (img-hi3br8jx)' },
    { value: 'img-gpu-cuda', label: 'Ubuntu 22.04 CUDA GPU (img-gpu-cuda)', gpu: true },
  ],
  aws: [
    { value: 'ami-0c55b159cbfafe1f0', label: 'Amazon Linux 2 (ami-0c55b159cbfafe1f0, us-east-1)' },
    { value: 'ami-0b5eea76982371e91', label: 'Amazon Linux 2023 (ami-0b5eea76982371e91, us-east-1)' },
    { value: 'ami-007855ac798b5175e', label: 'Ubuntu 22.04 LTS (ami-007855ac798b5175e, us-east-1)' },
    { value: 'ami-055744c75048d8296', label: 'Ubuntu 20.04 LTS (ami-055744c75048d8296, us-east-1)' },
    { value: 'ami-0gpu0000000000001', label: 'Deep Learning AMI GPU PyTorch (ami-0gpu0000000000001, us-east-1)', gpu: true },
  ],
  huawei: [
    { value: 'Ubuntu 22.04 server 64bit', label: 'Ubuntu 22.04 server 64bit' },
    { value: 'Ubuntu 20.04 server 64bit', label: 'Ubuntu 20.04 server 64bit' },
    { value: 'CentOS 7.9 64bit', label: 'CentOS 7.9 64bit' },
    { value: 'EulerOS 2.9 64bit', label: 'EulerOS 2.9 64bit' },
    { value: 'openEuler 22.03 64bit', label: 'openEuler 22.03 64bit' },
    { value: 'Ubuntu 22.04 CUDA GPU 64bit', label: 'Ubuntu 22.04 CUDA GPU 64bit', gpu: true },
  ],
}

const FALLBACK_VENDOR = 'aliyun'

export function localImageOptions(vendor) {
  return LOCAL_IMAGES[vendor] || LOCAL_IMAGES[FALLBACK_VENDOR]
}

export function localDefaultImage(vendor) {
  const list = localImageOptions(vendor)
  return list[0] ? list[0].value : ''
}
