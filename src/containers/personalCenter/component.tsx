import React from "react";
import "./personalCenter.css";
import NoteList from "../lists/noteList";
import {
  ConfigService,
  ReadingTimeUtil,
} from '../../services';
import {
  getOrCreateDisplayName,
  saveDisplayName,
} from "../../utils/collab/roomBook";
import {
  getCollabServerUrlSetting,
  saveCollabServerUrlSetting,
  getCollabServerTokenSetting,
  saveCollabServerTokenSetting,
  testCollabServerConnection,
  CollabServerTestResult,
} from "../../utils/collab/collabServerConfig";

// 「个人中心」页:共读昵称 + 共读服务器 + 我的笔记 / 高亮 + 阅读数据
// 从左侧边栏「我的」进入,与「个人设置」里的昵称是同一个存储

interface PersonalCenterProps {
  history: any;
  t: (key: string) => string;
}

interface PersonalCenterState {
  tab: "profile" | "note" | "highlight" | "stats";
  displayName: string;
  /** 共读服务器地址;空串 = 未配置 = 本地阅读器模式 */
  serverUrl: string;
  /** 共读鉴权 Token;空串 = 无鉴权 */
  serverToken: string;
  totalSeconds: number;
  weekSeconds: number;
  streakDays: number;
  isStatsLoading: boolean;
  isTestingConnection: boolean;
  testResult: CollabServerTestResult | null;
}

const TABS = [
  { key: "profile", label: "个人信息" },
  { key: "note", label: "我的笔记" },
  { key: "highlight", label: "我的高亮" },
  { key: "stats", label: "我的阅读数据" },
] as const;

class PersonalCenter extends React.Component<
  PersonalCenterProps,
  PersonalCenterState
> {
  private readingTimeUtil: any;

  constructor(props: PersonalCenterProps) {
    super(props);
    this.readingTimeUtil = new ReadingTimeUtil(ConfigService, {
      registerUnloadHandler: () => () => {},
    });
    // 没设置过昵称就生成 7 位随机 ID 当默认昵称
    this.state = {
      tab: "profile",
      displayName: getOrCreateDisplayName(),
      serverUrl: getCollabServerUrlSetting(),
      serverToken: getCollabServerTokenSetting(),
      totalSeconds: 0,
      weekSeconds: 0,
      streakDays: 0,
      isStatsLoading: true,
      isTestingConnection: false,
      testResult: null,
    };
  }

  componentDidMount() {
    if (this.state.tab === "stats") this.loadStats();
  }

  componentDidUpdate(_prevProps: PersonalCenterProps, prevState: PersonalCenterState) {
    if (prevState.tab !== "stats" && this.state.tab === "stats") {
      this.loadStats();
    }
  }

  loadStats = () => {
    this.setState({ isStatsLoading: true });
    const allDates: string[] = this.readingTimeUtil.getAllDates();
    const dateSecondsMap: Record<string, number> = {};
    let totalSeconds = 0;
    for (const dateKey of allDates) {
      const dayStats = this.readingTimeUtil.getDayStats(dateKey);
      const dayTotal = dayStats.reduce(
        (sum: number, s: any) => sum + s.seconds,
        0
      );
      totalSeconds += dayTotal;
      dateSecondsMap[dateKey] = dayTotal;
    }

    // 最近 7 天(含今天)的阅读时长
    let weekSeconds = 0;
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = this.dateToKey(d);
      weekSeconds += dateSecondsMap[key] || 0;
    }

    // 连续阅读天数(从今天往前数)
    let streakDays = 0;
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      if ((dateSecondsMap[this.dateToKey(d)] || 0) > 0) {
        streakDays++;
      } else {
        break;
      }
    }
    this.setState({ totalSeconds, weekSeconds, streakDays, isStatsLoading: false });
  };

  handleNicknameChange = (value: string) => {
    this.setState({ displayName: value });
  };

  handleNicknameBlur = () => {
    saveDisplayName(this.state.displayName);
    this.setState({ displayName: getOrCreateDisplayName() });
  };

  handleServerUrlChange = (value: string) => {
    this.setState({ serverUrl: value });
  };

  // 失焦才落盘(不边打字边存),并把规范化后的地址回填输入框 ——
  // 用户填「192.168.1.5:17390」时会立刻看到被补成「https://your-server.example.com」。
  handleServerUrlBlur = () => {
    const saved = saveCollabServerUrlSetting(this.state.serverUrl);
    this.setState({ serverUrl: saved });
  };

  handleServerTokenChange = (value: string) => {
    this.setState({ serverToken: value });
  };

  handleServerTokenBlur = () => {
    const saved = saveCollabServerTokenSetting(this.state.serverToken);
    this.setState({ serverToken: saved });
  };

  handleTestConnection = async () => {
    if (this.state.isTestingConnection) return;
    this.setState({ isTestingConnection: true, testResult: null });
    try {
      const result = await testCollabServerConnection(
        this.state.serverUrl,
        this.state.serverToken
      );
      this.setState({ testResult: result });
    } catch (e: any) {
      this.setState({
        testResult: {
          ok: false,
          message: "测试过程发生未知错误",
          hint: e?.message || String(e),
        },
      });
    } finally {
      this.setState({ isTestingConnection: false });
    }
  };

  dateToKey(d: Date) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  formatTime(seconds: number) {
    if (seconds < 60) return `${seconds} 秒`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h} 小时 ${m} 分钟`;
    return `${m} 分钟`;
  }

  render() {
    return (
      <div className="personal-center-container-parent">
        <div className="personal-center-tabs">
          {TABS.map((tab) => (
            <div
              key={tab.key}
              className={
                this.state.tab === tab.key
                  ? "personal-center-tab active"
                  : "personal-center-tab"
              }
              onClick={() => this.setState({ tab: tab.key })}
            >
              {tab.label}
            </div>
          ))}
        </div>

        {this.state.tab === "profile" && (
          <>
            <div className="personal-center-section">
              <div className="personal-center-section-title">共读昵称</div>
              <div className="personal-center-hint">
                在共读房间里向书友展示的名字。没设置过的话,系统会给你生成一个 7
                位随机 ID(数字 + 大小写字母),可以随时改。
              </div>
              <input
                className="personal-center-input"
                value={this.state.displayName}
                maxLength={24}
                placeholder="Reader"
                onChange={(event) => this.handleNicknameChange(event.target.value)}
                onBlur={this.handleNicknameBlur}
              />
              <div className="personal-center-hint">
                修改后立即生效,共读面板和聊天里都会使用这个昵称。
              </div>
            </div>

            <div className="personal-center-section personal-center-section-divider">
              <div className="personal-center-section-title">共读服务器</div>
              <div className="personal-center-hint">
                和书友共读时使用的服务器地址,形如 https://your-server.example.com 或
                https://你的域名/collab(由你自己部署的共读服务提供)。
                <br />
                留空则只作为本地阅读器使用,不显示共读房间。
              </div>
              <input
                className="personal-center-input"
                value={this.state.serverUrl}
                placeholder="https://your-server.example.com"
                onChange={(event) => this.handleServerUrlChange(event.target.value)}
                onBlur={this.handleServerUrlBlur}
              />
              <div className="personal-center-hint">
                {this.state.serverUrl
                  ? "已启用共读:「共同阅读」页可以创建 / 加入房间。"
                  : "当前为本地阅读器模式:共读功能不可用。"}
                <br />
                修改地址后,请退出并重新进入共读房间才会生效。
              </div>

              <div className="personal-center-section-title" style={{ marginTop: "16px" }}>
                共读鉴权 Token（可选）
              </div>
              <div className="personal-center-hint">
                若你的共读服务器配置了 COLLAB_TOKEN，请在此填写；未配置请留空。
              </div>
              <input
                className="personal-center-input"
                type="password"
                value={this.state.serverToken}
                placeholder="共读服务 Token (可选)"
                onChange={(event) => this.handleServerTokenChange(event.target.value)}
                onBlur={this.handleServerTokenBlur}
              />

              <div className="personal-center-test-row">
                <button
                  type="button"
                  className={`personal-center-test-btn ${this.state.isTestingConnection ? "loading" : ""}`}
                  disabled={this.state.isTestingConnection}
                  onClick={this.handleTestConnection}
                >
                  {this.state.isTestingConnection ? "正在测试连通性..." : "测试连接"}
                </button>
                {this.state.testResult && (
                  <span
                    className={`personal-center-test-badge ${
                      this.state.testResult.ok ? "success" : "error"
                    }`}
                  >
                    {this.state.testResult.ok ? "✓ " : "✕ "}
                    {this.state.testResult.message}
                  </span>
                )}
              </div>
              {this.state.testResult?.hint && (
                <div
                  className={`personal-center-test-hint ${
                    this.state.testResult.ok ? "success" : "error"
                  }`}
                >
                  {this.state.testResult.hint}
                </div>
              )}
            </div>
          </>
        )}

        {this.state.tab === "note" && (
          <div className="personal-center-note-wrapper">
            <NoteList {...({ tabMode: "note" } as any)} />
          </div>
        )}

        {this.state.tab === "highlight" && (
          <div className="personal-center-note-wrapper">
            <NoteList {...({ tabMode: "highlight" } as any)} />
          </div>
        )}

        {this.state.tab === "stats" && (
          <div className="personal-center-section">
            <div className="personal-center-section-title">阅读数据</div>
            {this.state.isStatsLoading ? (
              <div className="personal-center-hint">统计中...</div>
            ) : (
              <div className="personal-center-stats-row">
                <div className="personal-center-stat-card">
                  <div className="personal-center-stat-value">
                    {this.formatTime(this.state.totalSeconds)}
                  </div>
                  <div className="personal-center-stat-label">累计阅读时长</div>
                </div>
                <div className="personal-center-stat-card">
                  <div className="personal-center-stat-value">
                    {this.formatTime(this.state.weekSeconds)}
                  </div>
                  <div className="personal-center-stat-label">最近 7 天</div>
                </div>
                <div className="personal-center-stat-card">
                  <div className="personal-center-stat-value">
                    {this.state.streakDays} 天
                  </div>
                  <div className="personal-center-stat-label">连续阅读</div>
                </div>
              </div>
            )}
            <div
              className="personal-center-link"
              onClick={() => this.props.history.push("/stats")}
            >
              查看完整阅读统计(30 天曲线 + 热力图) →
            </div>
          </div>
        )}
      </div>
    );
  }
}

export default PersonalCenter;
